# Expo Updates Worker

Self-Hosted Expo Updates Server running on Cloudflare Workers with D1 (SQLite), R2 (Object Storage), and a React dashboard.

## Features

- **Expo Updates Protocol** - Full compatibility with expo-updates
- **Code Signing** - RSA-SHA256 signature verification
- **Multi-App Support** - Manage multiple Expo applications
- **Release Channels** - Staging, production, and custom channels
- **Client Analytics** - Track which devices are using your updates
- **Web Dashboard** - React-based management interface
- **Edge Deployment** - Global distribution via Cloudflare's network

## Prerequisites

- Node.js >= 18.0.0
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Cloudflare account (free tier works!)
- An Expo project using expo-updates

## Quick Start

### 1. Automated Setup

The easiest way to get started:

```bash
cd worker
npm install
npm run setup
```

This will:
- Create D1 database and R2 bucket
- Configure wrangler.toml
- Set up secrets (JWT_SECRET, UPLOAD_KEY, ADMIN_PASSWORD)
- Apply database migrations
- Build the web dashboard

### 2. Manual Setup

If you prefer manual setup:

```bash
# Install dependencies
cd worker
npm install

# Create Cloudflare resources
npx wrangler d1 create expo-updates
npx wrangler r2 bucket create expo-updates

# Update wrangler.toml with your database ID (from create command output)
# database_id = "your-database-id-here"

# Set secrets
npx wrangler secret put JWT_SECRET    # Generate: openssl rand -base64 32
npx wrangler secret put UPLOAD_KEY    # Generate: openssl rand -hex 16
npx wrangler secret put ADMIN_PASSWORD

# Generate and apply migrations
npm run db:generate
npm run db:migrate

# Build web dashboard
npm run build:web

# Deploy
npm run deploy
```

### 3. Local Development

```bash
# Apply migrations locally
npm run db:migrate:local

# Build web dashboard
npm run build:web

# Start dev server
npm run dev
```

Visit `http://localhost:3000` to access the dashboard.

**Default credentials**: admin / (your ADMIN_PASSWORD)

---

## Web Dashboard

The web dashboard is served as static assets from the same worker.

### Building the Dashboard

```bash
npm run build:web
```

This compiles the React app from `../Web` and copies it to `./public`.

### How It Works

1. API routes (`/api/*`, `/apps`, etc.) are handled by Hono
2. Static assets are served from the `public` directory
3. The `env-config.js` is generated dynamically with the correct API URL
4. SPA routing falls back to `index.html` for client-side navigation

---

## Configuring Your Expo App

To use this server for OTA updates, configure your Expo app:

### app.json Configuration

```json
{
  "expo": {
    "name": "My App",
    "slug": "my-app",
    "version": "1.0.0",
    "runtimeVersion": "1.0.0",
    "updates": {
      "enabled": true,
      "url": "https://your-worker.workers.dev/api/manifest?project=my-app&channel=production",
      "checkAutomatically": "ON_LOAD",
      "fallbackToCacheTimeout": 30000
    }
  }
}
```

### app.config.js (Dynamic Configuration)

```javascript
const slug = 'my-app';
const version = '1.0.0';
const runtimeVersion = '1.0.0';
const releaseChannel = process.env.RELEASE_CHANNEL || 'staging';
const serverUrl = 'https://your-worker.workers.dev';

export default ({ config }) => ({
  ...config,
  slug,
  version,
  runtimeVersion,
  updates: {
    enabled: true,
    url: `${serverUrl}/api/manifest?project=${slug}&channel=${releaseChannel}`,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 30000,
  },
});
```

### With Code Signing

For additional security, enable code signing:

1. Generate a certificate in the dashboard (Apps → Your App → Generate Certificate)
2. Download the certificate and save as `code-signing/certificate.pem` in your project
3. Update your app config:

```json
{
  "expo": {
    "updates": {
      "url": "https://your-worker.workers.dev/api/manifest?project=my-app&channel=production",
      "codeSigningCertificate": "./code-signing/certificate.pem",
      "codeSigningMetadata": {
        "keyid": "main",
        "alg": "rsa-v1_5-sha256"
      }
    }
  }
}
```

### Key Configuration Parameters

| Parameter | Description |
|-----------|-------------|
| `slug` | Unique identifier for your app (must match project in URL) |
| `version` | Semantic version (e.g., "1.0.0") |
| `runtimeVersion` | Runtime compatibility version |
| `updates.url` | Manifest URL with `project` and `channel` query params |
| `updates.checkAutomatically` | When to check: `ON_LOAD`, `ON_ERROR_RECOVERY`, `NEVER` |
| `updates.fallbackToCacheTimeout` | Timeout in ms (0 = no timeout) |

---

## Publishing Updates

### Using the Publish Script

```bash
# From your Expo project directory
./scripts/expo-publish.sh <channel> <project-path> <upload-key> <server-url>

# Example
./scripts/expo-publish.sh production . your-upload-key https://your-worker.workers.dev
```

### Manual Publishing

```bash
# 1. Export your app
npx expo export --output-dir dist

# 2. Upload to server
curl -X POST "https://your-worker.workers.dev/upload" \
  -H "project: my-app" \
  -H "version: 1.0.0" \
  -H "release-channel: production" \
  -H "upload-key: your-upload-key" \
  -F "metadata.json=@dist/metadata.json" \
  -F "bundles/ios-xxx.js=@dist/bundles/ios-xxx.js" \
  -F "bundles/android-xxx.js=@dist/bundles/android-xxx.js" \
  -F "app.json=@app.json"

# 3. Release via dashboard or API
curl -X POST "https://your-worker.workers.dev/utils/release" \
  -H "Authorization: Bearer <jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"uploadId": "upload-id-from-step-2"}'
```

### Release Workflow

1. **Upload** - Creates update with status `ready`
2. **Review** - View in dashboard, check metadata
3. **Release** - Change status to `released` (now live!)
4. **Rollback** - Revert to a previous release if needed

---

## API Reference

### Public Endpoints (No Auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Health check |
| `GET` | `/api/manifest` | Expo update manifest |
| `GET` | `/api/assets` | Asset files from R2 |

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/authentication` | Login, returns JWT |

### Protected Endpoints (JWT Required)

| Method | Path | Description |
|--------|------|-------------|
| `GET/POST` | `/apps` | List/create apps |
| `GET/PATCH/DELETE` | `/apps/:id` | Manage app |
| `GET` | `/uploads` | List uploads |
| `GET/PATCH/DELETE` | `/uploads/:id` | Manage upload |
| `GET` | `/clients` | List client devices |
| `GET` | `/stats/:project` | Project statistics |
| `POST` | `/utils/release` | Release an upload |
| `POST` | `/utils/rollback` | Rollback to previous |
| `GET` | `/utils/upload-key` | Get upload key |
| `POST` | `/utils/generate-certificate` | Generate signing keys |

### Upload Endpoint (Upload Key Required)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Upload new update bundle |

---

## Environment Variables

### Development (.dev.vars)

```bash
# Generate secrets
JWT_SECRET=$(openssl rand -base64 32)
UPLOAD_KEY=$(openssl rand -hex 16)
ADMIN_PASSWORD=your-secure-password
```

Copy `.dev.vars.example` to `.dev.vars` and fill in values.

### Production

Set via `wrangler secret put`:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put UPLOAD_KEY
npx wrangler secret put ADMIN_PASSWORD
```

### wrangler.toml vars

| Variable | Description |
|----------|-------------|
| `PUBLIC_URL` | Public URL of your worker |

---

## Project Structure

```
worker/
├── src/
│   ├── index.ts              # Main entry (Hono app + static assets)
│   ├── types.ts              # TypeScript types
│   ├── db/
│   │   └── schema.ts         # Drizzle ORM schema
│   ├── routes/
│   │   ├── api.ts            # Expo manifest/assets
│   │   ├── auth.ts           # Authentication
│   │   ├── apps.ts           # App management
│   │   ├── uploads.ts        # Upload management
│   │   ├── clients.ts        # Client tracking
│   │   ├── stats.ts          # Statistics
│   │   └── utils.ts          # Utilities
│   ├── services/
│   │   ├── manifest.ts       # Manifest generation
│   │   └── md5.ts            # MD5 hashing
│   └── middleware/
│       └── auth.ts           # Auth middleware
├── public/                   # Built web dashboard (generated)
├── drizzle/
│   └── migrations/           # Database migrations
├── wrangler.toml             # Cloudflare Worker config
├── package.json
└── tsconfig.json
```

---

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local dev server |
| `npm run deploy` | Deploy to Cloudflare |
| `npm run build:web` | Build web dashboard |
| `npm run setup` | Automated initial setup |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | Run oxlint linter |
| `npm run format` | Format with oxfmt |
| `npm run check` | Run all checks |
| `npm run db:generate` | Generate migrations |
| `npm run db:migrate` | Apply migrations |
| `npm run db:migrate:local` | Apply to local DB |

---

## Tooling

This project uses modern, fast tooling:

| Tool | Purpose | Speed Improvement |
|------|---------|-------------------|
| [tsgo](https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/) | Type checking | ~10x faster |
| [oxlint](https://oxc.rs/) | Linting | ~50-100x faster |
| [oxfmt](https://oxc.rs/docs/guide/usage/formatter) | Formatting | ~30x faster |
| [Hono](https://hono.dev/) | Web framework | Edge-native |
| [Drizzle](https://orm.drizzle.team/) | ORM | Type-safe |

---

## Troubleshooting

### "Database not found"

```bash
npx wrangler d1 create expo-updates
# Update wrangler.toml with the database_id
```

### "R2 bucket not found"

```bash
npx wrangler r2 bucket create expo-updates
```

### "Static assets not configured"

```bash
npm run build:web
```

### "No updates available" (404 on manifest)

1. Check that the `project` query param matches your app slug
2. Verify there's a `released` upload for your runtime version and channel
3. Check the `/uploads` endpoint to see upload statuses

### Local database reset

```bash
rm -rf .wrangler/state
npm run db:migrate:local
```

---

## Cost Considerations

| Resource | Free Tier | Expected Cost |
|----------|-----------|---------------|
| Workers | 100K req/day | Low |
| D1 | 5M reads/day, 100K writes/day | Low |
| R2 | 10GB storage, 10M ops/month | Low-Medium |

Most small-medium deployments fit within the free tier.

---

## License

MIT
