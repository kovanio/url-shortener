import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import app from './index'

// Mock KV Namespace
const createMockKV = () => {
  const store = new Map<string, string>()
  return {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) || null)),
    put: vi.fn((key: string, value: string) => {
      store.set(key, value)
      return Promise.resolve()
    }),
    _store: store
  }
}

// Mock D1 Database
const createMockD1 = () => {
  const data: any[] = []
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: any[]) => ({
        run: vi.fn(() => {
          if (sql.includes('INSERT')) {
            data.push({
              slug: args[0],
              ip: args[1],
              country: args[2],
              user_agent: args[3],
              is_bot: args[4],
              created_at: new Date().toISOString()
            })
          }
          return Promise.resolve({ success: true })
        }),
        first: vi.fn(() => {
          if (sql.includes('COUNT')) {
            const count = data.filter(d => d.slug === args[0]).length
            return Promise.resolve({ total: count })
          }
          if (sql.includes('SUM')) {
            const filtered = data.filter(d => d.slug === args[0])
            return Promise.resolve({
              bot_clicks: filtered.filter(d => d.is_bot === 1).length,
              human_clicks: filtered.filter(d => d.is_bot === 0).length
            })
          }
          return Promise.resolve(null)
        }),
        all: vi.fn(() => {
          const filtered = data.filter(d => d.slug === args[0])
          return Promise.resolve({ results: filtered.slice(0, 20) })
        })
      }))
    })),
    _data: data
  }
}

// Helper to create mock execution context
const createMockExecutionCtx = () => ({
  waitUntil: vi.fn((promise: Promise<any>) => promise),
  passThroughOnException: vi.fn()
})

describe('URL Shortener API', () => {
  let mockKV: ReturnType<typeof createMockKV>
  let mockD1: ReturnType<typeof createMockD1>
  let mockExecutionCtx: ReturnType<typeof createMockExecutionCtx>

  beforeEach(() => {
    mockKV = createMockKV()
    mockD1 = createMockD1()
    mockExecutionCtx = createMockExecutionCtx()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })))
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const createRequest = (method: string, path: string, body?: object, headers?: Record<string, string>) => {
    const url = `http://localhost${path}`
    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }
    if (body) {
      init.body = JSON.stringify(body)
    }
    return new Request(url, init)
  }

  describe('POST /api/shorten', () => {
    it('should create a short URL successfully', async () => {
      const req = createRequest('POST', '/api/shorten', { url: 'https://example.com' })
      
      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.status).toBe(201)
      
      const json = await res.json() as any
      expect(json.original_url).toBe('https://example.com')
      expect(json.short_url).toMatch(/^http:\/\/localhost\/[a-zA-Z0-9]{6}$/)
      expect(json.slug).toHaveLength(6)
      expect(json.stats_url).toContain('/api/stats/')
      expect(mockKV.put).toHaveBeenCalled()
    })

    it('should create a short URL with a custom slug', async () => {
      const req = createRequest('POST', '/api/shorten', { url: 'https://example.com', slug: 'my_custom-slug' })

      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.status).toBe(201)

      const json = await res.json() as any
      expect(json.slug).toBe('my_custom-slug')
      expect(json.short_url).toBe('http://localhost/my_custom-slug')
      expect(json.stats_url).toBe('http://localhost/api/stats/my_custom-slug')
      expect(mockKV.put).toHaveBeenCalledWith('my_custom-slug', 'https://example.com')
    })

    it('should return 409 when custom slug already exists', async () => {
      mockKV._store.set('takenSlug', 'https://already.example')

      const req = createRequest('POST', '/api/shorten', { url: 'https://example.com', slug: 'takenSlug' })

      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.status).toBe(409)
      const json = await res.json() as any
      expect(json.error).toBe('Slug already in use')
    })

    it('should return 400 for invalid custom slug format', async () => {
      const req = createRequest('POST', '/api/shorten', { url: 'https://example.com', slug: 'invalid!' })

      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.status).toBe(400)
      const json = await res.json() as any
      expect(json.error).toBe('Invalid slug')
    })

    it.each(['api', 'stats'])('should return 400 for reserved slug "%s"', async (reserved) => {
      const req = createRequest('POST', '/api/shorten', { url: 'https://example.com', slug: reserved })

      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.status).toBe(400)
      const json = await res.json() as any
      expect(json.error).toBe('Slug is reserved')
    })

    it('should still generate a random slug when none is provided (regression)', async () => {
      const req = createRequest('POST', '/api/shorten', { url: 'https://example.com' })

      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.status).toBe(201)
      const json = await res.json() as any
      expect(json.slug).toMatch(/^[a-zA-Z0-9]{6}$/)
      expect(json.short_url).toMatch(/^http:\/\/localhost\/[a-zA-Z0-9]{6}$/)
    })

    it('should return 400 when URL is missing', async () => {
      const req = createRequest('POST', '/api/shorten', {})
      
      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.status).toBe(400)
      
      const json = await res.json() as any
      expect(json.error).toBe('URL is required')
    })

    it('should return 400 when body is empty', async () => {
      const req = createRequest('POST', '/api/shorten', { url: '' })
      
      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.status).toBe(400)
    })

    it('should check for slug uniqueness', async () => {
      const req = createRequest('POST', '/api/shorten', { url: 'https://example.com' })
      
      await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(mockKV.get).toHaveBeenCalled()
    })
  })

  describe('GET /:slug', () => {
    it('should redirect to original URL', async () => {
      // Pre-populate KV with a URL
      mockKV._store.set('abc123', 'https://example.com')
      
      const req = createRequest('GET', '/abc123', undefined, {
        'User-Agent': 'Mozilla/5.0',
        'CF-Connecting-IP': '1.2.3.4',
        'CF-IPCountry': 'US'
      })
      
      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.status).toBe(301)
      expect(res.headers.get('Location')).toBe('https://example.com')
    })

    it('should send a webhook notification on redirect (success)', async () => {
      mockKV._store.set('abc123', 'https://example.com')
      const fetchMock = globalThis.fetch as any

      const req = createRequest('GET', '/abc123', undefined, {
        'User-Agent': 'Mozilla/5.0',
        'CF-Connecting-IP': '1.2.3.4',
        'CF-IPCountry': 'US'
      })

      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1,
        CLAY_WEBHOOK_URL: 'https://example.test/webhook'
      }, mockExecutionCtx)

      expect(res.status).toBe(301)
      expect(res.headers.get('Location')).toBe('https://example.com')

      // Ensure async work finished
      await mockExecutionCtx.waitUntil.mock.calls[0][0]

      expect(fetchMock).toHaveBeenCalledTimes(1)

      const [url, init] = fetchMock.mock.calls[0] as any
      expect(url).toBe('https://example.test/webhook')
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual(
        expect.objectContaining({
          'Content-Type': 'application/json'
        })
      )

      const payload = JSON.parse(init.body)
      expect(payload).toEqual(
        expect.objectContaining({
          slug: 'abc123',
          url: 'https://example.com',
          ip: '1.2.3.4',
          country: 'US',
          user_agent: 'Mozilla/5.0'
        })
      )
      expect(payload.is_bot).toBe(false)
      expect(typeof payload.timestamp).toBe('string')
    })

    it('should not fail redirect if webhook rejects (resilience)', async () => {
      mockKV._store.set('abc123', 'https://example.com')
      const fetchMock = globalThis.fetch as any
      fetchMock.mockRejectedValueOnce(new Error('webhook down'))

      const req = createRequest('GET', '/abc123', undefined, {
        'User-Agent': 'Mozilla/5.0',
        'CF-Connecting-IP': '1.2.3.4',
        'CF-IPCountry': 'US'
      })

      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1,
        CLAY_WEBHOOK_URL: 'https://example.test/webhook'
      }, mockExecutionCtx)

      expect(res.status).toBe(301)
      expect(res.headers.get('Location')).toBe('https://example.com')

      // Ensure async work finished (and error was handled)
      await mockExecutionCtx.waitUntil.mock.calls[0][0]

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should skip webhook when CLAY_WEBHOOK_URL is not set (warn + continue)', async () => {
      mockKV._store.set('abc123', 'https://example.com')
      const fetchMock = globalThis.fetch as any
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const req = createRequest('GET', '/abc123', undefined, {
        'User-Agent': 'Mozilla/5.0',
        'CF-Connecting-IP': '1.2.3.4',
        'CF-IPCountry': 'US'
      })

      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
        // CLAY_WEBHOOK_URL intentionally omitted
      }, mockExecutionCtx)

      expect(res.status).toBe(301)
      expect(res.headers.get('Location')).toBe('https://example.com')

      // Ensure async work finished
      await mockExecutionCtx.waitUntil.mock.calls[0][0]

      // Webhook should NOT have been called
      expect(fetchMock).toHaveBeenCalledTimes(0)
      expect(warnSpy).toHaveBeenCalledWith('CLAY_WEBHOOK_URL not set, skipping webhook notification')

      warnSpy.mockRestore()
    })

    it('should return 404 for non-existent slug', async () => {
      const req = createRequest('GET', '/nonexistent')
      
      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.status).toBe(404)
      expect(await res.text()).toBe('URL Not Found')
    })

    it('should log analytics asynchronously', async () => {
      mockKV._store.set('abc123', 'https://example.com')
      
      const req = createRequest('GET', '/abc123', undefined, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'CF-Connecting-IP': '192.168.1.1',
        'CF-IPCountry': 'DE'
      })
      
      await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(mockExecutionCtx.waitUntil).toHaveBeenCalled()
    })

    it('should detect bot user agents and skip webhook notification', async () => {
      mockKV._store.set('abc123', 'https://example.com')
      const fetchMock = globalThis.fetch as any
      
      const req = createRequest('GET', '/abc123', undefined, {
        'User-Agent': 'Googlebot/2.1',
        'CF-Connecting-IP': '66.249.66.1',
        'CF-IPCountry': 'US'
      })
      
      await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1,
        CLAY_WEBHOOK_URL: 'https://example.test/webhook'
      }, mockExecutionCtx)

      // Wait for async analytics logging
      await mockExecutionCtx.waitUntil.mock.calls[0][0]
      
      // Database logging should still happen for bots
      expect(mockD1.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO analytics')
      )

      // Webhook should NOT be called for bot traffic
      expect(fetchMock).toHaveBeenCalledTimes(0)
    })
  })

  describe('GET /api/stats/:slug', () => {
    it('should return stats for a slug', async () => {
      // Add some mock analytics data
      mockD1._data.push(
        { slug: 'abc123', is_bot: 0, ip: '1.1.1.1', country: 'US', user_agent: 'Mozilla', created_at: new Date().toISOString() },
        { slug: 'abc123', is_bot: 0, ip: '2.2.2.2', country: 'UK', user_agent: 'Chrome', created_at: new Date().toISOString() },
        { slug: 'abc123', is_bot: 1, ip: '3.3.3.3', country: 'DE', user_agent: 'Googlebot', created_at: new Date().toISOString() }
      )
      
      const req = createRequest('GET', '/api/stats/abc123')
      
      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.status).toBe(200)
      
      const json = await res.json() as any
      expect(json.slug).toBe('abc123')
      expect(json.total_clicks).toBe(3)
      expect(json.breakdown.human).toBe(2)
      expect(json.breakdown.bot).toBe(1)
      expect(json.recent_activity).toHaveLength(3)
    })

    it('should return zero stats for unknown slug', async () => {
      const req = createRequest('GET', '/api/stats/unknown')
      
      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.status).toBe(200)
      
      const json = await res.json() as any
      expect(json.slug).toBe('unknown')
      expect(json.total_clicks).toBe(0)
      expect(json.breakdown.human).toBe(0)
      expect(json.breakdown.bot).toBe(0)
      expect(json.recent_activity).toHaveLength(0)
    })
  })

  describe('CORS', () => {
    it('should include CORS headers', async () => {
      const req = createRequest('GET', '/api/stats/test')
      
      const res = await app.fetch(req, {
        URL_DB: mockKV,
        DB: mockD1
      }, mockExecutionCtx)

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })
  })
})

describe('Bot Detection', () => {
  // These tests verify the bot detection regex patterns
  const shouldMatchBotPattern = [
    'Googlebot/2.1 (+http://www.google.com/bot.html)',
    'Mozilla/5.0 (compatible; Bingbot/2.0)',
    'facebookexternalhit/1.1',
    'Twitterbot/1.0',
    'WhatsApp/2.21.4.22',
    'Slackbot-LinkExpanding 1.0',
    'Baiduspider/2.0'
  ]

  const shouldNotMatchBotPattern = [
    // Crawlers not covered by the current pattern
    'Mozilla/5.0 (compatible; Yahoo! Slurp)'
  ]

  const humanUserAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
    'Mozilla/5.0 (Linux; Android 11; SM-G991B)'
  ]

  const botPattern = /bot|spider|crawl|preview|whatsapp|facebook|twitter|slack/i

  it.each(shouldMatchBotPattern)('should detect "%s" as a bot', (ua) => {
    expect(botPattern.test(ua)).toBe(true)
  })

  it.each(shouldNotMatchBotPattern)('should not detect "%s" as a bot', (ua) => {
    expect(botPattern.test(ua)).toBe(false)
  })

  it.each(humanUserAgents)('should detect "%s" as human', (ua) => {
    expect(botPattern.test(ua)).toBe(false)
  })
})
