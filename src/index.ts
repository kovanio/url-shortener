import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { customAlphabet } from 'nanoid'

// Setup NanoID: Only alphanumeric characters, length 6
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 6)

// Define environment bindings for Cloudflare
type Bindings = {
  URL_DB: KVNamespace // Key-Value store for fast redirects
  DB: D1Database      // SQL database for analytics
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for frontend access
app.use('/*', cors())

/**
 * Helper function to detect bots based on User-Agent string.
 * This helps in distinguishing real user clicks from crawlers.
 */
const isBot = (userAgent: string | undefined): boolean => {
  if (!userAgent) return true;
  const botPattern = /bot|spider|crawl|preview|whatsapp|facebook|twitter|slack/i;
  return botPattern.test(userAgent);
}

/**
 * POST /api/shorten
 * Creates a short URL from a long URL.
 * Uses KV for storage and ensures uniqueness.
 */
app.post('/api/shorten', async (c) => {
  try {
    const { url } = await c.req.json()
    
    if (!url) {
      return c.json({ error: 'URL is required' }, 400)
    }

    let slug: string = "";
    let isUnique = false;
    let attempts = 0;

    // Collision Check Loop: Ensure the generated ID doesn't already exist
    while (!isUnique && attempts < 5) {
      slug = nanoid(); // Generate random ID (e.g., "x7K9Lm")
      
      // Check if this ID exists in KV
      const existing = await c.env.URL_DB.get(slug);
      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return c.json({ error: 'Failed to generate unique ID. Please try again.' }, 500);
    }

    // Save to KV Store (Key: slug, Value: longUrl)
    await c.env.URL_DB.put(slug, url)
    
    const workerUrl = new URL(c.req.url).origin

    return c.json({ 
      original_url: url, 
      short_url: `${workerUrl}/${slug}`,
      stats_url: `${workerUrl}/api/stats/${slug}`,
      slug: slug 
    }, 201)

  } catch (error) {
    console.error(error);
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

/**
 * GET /:slug
 * Redirects the user to the original URL.
 * Logs the visit asynchronously to D1 database.
 */
app.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  
  // 1. Fetch from KV (Fastest method)
  const longUrl = await c.env.URL_DB.get(slug)

  if (!longUrl) {
    return c.text('URL Not Found', 404)
  }

  // 2. Log analytics asynchronously (Does not block the redirect)
  c.executionCtx.waitUntil((async () => {
    try {
      const userAgent = c.req.header('User-Agent') || ''
      const ip = c.req.header('CF-Connecting-IP') || 'Unknown'
      const country = c.req.header('CF-IPCountry') || 'Unknown'
      const botStatus = isBot(userAgent) ? 1 : 0

      // Secure SQL Insert
      await c.env.DB.prepare(
        `INSERT INTO analytics (slug, ip, country, user_agent, is_bot) VALUES (?, ?, ?, ?, ?)`
      ).bind(slug, ip, country, userAgent, botStatus).run()
      
    } catch (err) {
      console.error('Analytics logging failed:', err)
    }
  })())

  // 3. Perform the redirect
  return c.redirect(longUrl, 301)
})

/**
 * GET /api/stats/:slug
 * Retrieves click statistics from the D1 database.
 */
app.get('/api/stats/:slug', async (c) => {
  const slug = c.req.param('slug')
  
  // Query 1: Get total click count
  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total FROM analytics WHERE slug = ?`
  ).bind(slug).first()

  // Query 2: Get last 20 visits (Detailed logs)
  const logsResult = await c.env.DB.prepare(
    `SELECT * FROM analytics WHERE slug = ? ORDER BY created_at DESC LIMIT 20`
  ).bind(slug).all()

  // Query 3: Bot vs Human count
  const botResult = await c.env.DB.prepare(
    `SELECT 
      SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) as bot_clicks,
      SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) as human_clicks
     FROM analytics WHERE slug = ?`
  ).bind(slug).first()

  return c.json({
    slug,
    total_clicks: countResult?.total || 0,
    breakdown: {
      human: botResult?.human_clicks || 0,
      bot: botResult?.bot_clicks || 0
    },
    recent_activity: logsResult.results
  })
})

export default app