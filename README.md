# url-tracker

A fast, minimal URL shortener built with [Hono](https://hono.dev) and [Cloudflare Workers](https://workers.cloudflare.com). Features KV-based redirects and D1-powered click analytics.

## Features

- 🚀 **Fast redirects** via Cloudflare KV
- 📊 **Click analytics** stored in D1 (SQLite)
- 🤖 **Bot detection** to separate human vs crawler traffic
- 🔗 **Custom slugs** or auto-generated short IDs
- 🌐 **CORS enabled** for frontend integrations
- 🔔 **Optional webhook** notifications on each click

## Prerequisites

- Node.js 18+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers enabled
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create Cloudflare resources

```bash
# Create KV namespace
npx wrangler kv namespace create URL_DB

# Create D1 database
npx wrangler d1 create url-analytics

# Initialize database schema
npx wrangler d1 execute url-analytics --file=schema.sql
```

### 3. Configure wrangler.jsonc

Edit `wrangler.jsonc` and replace the placeholder IDs with your actual values:

- `YOUR_KV_NAMESPACE_ID` → from `npx wrangler kv namespace list`
- `YOUR_D1_DATABASE_ID` → from `npx wrangler d1 list`

### 4. (Optional) Set up webhook

If you want click notifications sent to an external service:

```bash
npx wrangler secret put CLAY_WEBHOOK_URL
```

If not set, the worker will log a warning and continue without sending webhooks.

## Development

```bash
npm run dev
```

## Deploy

```bash
npm run deploy
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/shorten` | Create a short URL |
| GET | `/:slug` | Redirect to original URL |
| GET | `/api/stats/:slug` | Get click statistics |

### Create Short URL

```bash
curl -X POST https://your-worker.workers.dev/api/shorten \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "slug": "my-link"}'
```

## Type Generation

```bash
npm run cf-typegen
```

## Tests

```bash
npm test
```

---

## Maintainer Notes

> **Production Deployment:** To deploy using your local production config (with real IDs), run:
>
> ```bash
> npx wrangler deploy -c wrangler.prod.jsonc
> ```
>
> The `wrangler.prod.jsonc` file is git-ignored and should contain your actual Cloudflare resource IDs.

## License

MIT
