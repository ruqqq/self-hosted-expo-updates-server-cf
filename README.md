<h2 align="center">Self Hosted Expo Updates Server</h2>

<p align="center">
  <b>Cloudflare Workers Edition</b><br>
  A self-hosted OTA update server for Expo apps, running on the edge.
</p>

---

## Introduction

Self Hosted Expo Updates Server is a **batteries-included** solution for managing Expo OTA (Over-The-Air) updates that runs entirely on Cloudflare Workers. Deploy globally on the edge with D1 (SQLite) for data storage and R2 for asset storage.

**Why self-host your updates?**
- Full control over your update cycle
- Web dashboard for easy management
- Rollback capability with one click
- Real-time client tracking
- No vendor lock-in

## Features

- ✅ Manage multiple Expo apps
- ✅ Multiple runtime versions and release channels
- ✅ Platform-specific updates (iOS-only, Android-only, or both)
- ✅ Secure code signing with RSA-SHA256
- ✅ One-click rollback to previous versions
- ✅ Real-time client update tracking
- ✅ Self-signed certificate generation
- ✅ Edge deployment (200+ locations worldwide)
- ✅ Free tier friendly (Cloudflare Workers)

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Cloudflare account (free tier works!)

### Installation

```bash
# Clone the repository
git clone https://github.com/ruqqq/self-hosted-expo-updates-server-cf.git
cd self-hosted-expo-updates-server-cf

# Install dependencies
cd worker
npm install

# Create Cloudflare resources
npx wrangler d1 create expo-updates
npx wrangler r2 bucket create expo-updates

# Copy and configure wrangler.toml
cp wrangler.sample.toml wrangler.toml
# Edit wrangler.toml and add your database_id from the create command

# Set secrets
npx wrangler secret put JWT_SECRET    # Generate: openssl rand -base64 32
npx wrangler secret put UPLOAD_KEY    # Generate: openssl rand -hex 16
npx wrangler secret put ADMIN_PASSWORD

# Apply database migrations
npm run db:migrate

# Deploy!
npm run deploy
```

### Local Development

```bash
# Set up local environment
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your secrets

# Apply migrations locally
npm run db:migrate:local

# Start dev server
npm run dev
```

Visit `http://localhost:3000` - Login with **admin** / your ADMIN_PASSWORD.

## Usage

### 1. Add Your App

Use the web dashboard to add your application by entering the Expo slug name.

### 2. Configure Your Expo App

Update your `app.config.js`:

```javascript
const slug = 'my-app';
const serverUrl = 'https://your-worker.workers.dev';
const releaseChannel = process.env.RELEASE_CHANNEL || 'production';

export default ({ config }) => ({
  ...config,
  slug,
  runtimeVersion: '1.0.0',
  updates: {
    enabled: true,
    url: `${serverUrl}/api/manifest?project=${slug}&channel=${releaseChannel}`,
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 30000,
  },
});
```

### 3. Set Up Code Signing (Recommended)

1. Generate a certificate in the dashboard (Server Configuration → Generate Certificate)
2. Download `certificate.pem` and save to your project as `code-signing/certificate.pem`
3. Update your app config:

```javascript
updates: {
  // ... other config
  codeSigningCertificate: './code-signing/certificate.pem',
  codeSigningMetadata: {
    keyid: 'main',
    alg: 'rsa-v1_5-sha256',
  },
},
```

### 4. Publish Updates

Download the publish script from the dashboard, or use curl:

```bash
# Export your app
npx expo export --output-dir dist

# Upload to server
curl -X POST "https://your-worker.workers.dev/upload" \
  -H "project: my-app" \
  -H "version: 1.0.0" \
  -H "release-channel: production" \
  -H "upload-key: your-upload-key" \
  -F "metadata.json=@dist/metadata.json" \
  -F "app.json=@app.json" \
  -F "bundles/ios.js=@dist/bundles/ios-*.js" \
  -F "bundles/android.js=@dist/bundles/android-*.js"
```

### 5. Release & Manage

Use the web dashboard to:
- **Release** - Make an upload available to clients
- **Rollback** - Revert to a previous version
- **Monitor** - Track client downloads in real-time

## API Reference

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/status` | GET | - | Health check |
| `/api/manifest` | GET | - | Expo update manifest |
| `/api/assets` | GET | - | Asset files |
| `/authentication` | POST | - | Login (returns JWT) |
| `/apps` | GET/POST | JWT | List/create apps |
| `/apps/:id` | GET/PATCH/DELETE | JWT | Manage app |
| `/uploads` | GET | JWT | List uploads |
| `/uploads/:id` | GET/PATCH/DELETE | JWT | Manage upload |
| `/upload` | POST | Upload Key | Upload new bundle |
| `/utils/release` | POST | JWT | Release an upload |
| `/utils/rollback` | POST | JWT | Rollback to previous |

## Cost Considerations

| Resource | Free Tier | Typical Cost |
|----------|-----------|--------------|
| Workers | 100K req/day | Usually free |
| D1 | 5M reads/day, 100K writes | Usually free |
| R2 | 10GB storage, 10M ops/month | Low |

Most small-medium deployments fit within the free tier.

## Example Apps

The `ExampleManaged/` and `ExampleEjected/` directories contain sample Expo apps pre-configured to use this update server. Update the server URL in their config files to test.

## Development

```bash
cd worker

# Run dev server
npm run dev

# Run tests
npm test

# Run E2E tests
UPLOAD_KEY=your-key npm run test:e2e

# Type check
npm run typecheck

# Lint & format
npm run lint
npm run format

# Deploy
npm run deploy
```

## Troubleshooting

### Certificate Issues During Development

For Expo SDK >= 49, start the dev server with your private key:

```bash
npx expo start --private-key-path path/to/private-key.pem
```

Or allow unsigned manifests in development (AndroidManifest.xml / Expo.plist):

```xml
<meta-data android:name="expo.modules.updates.CODE_SIGNING_ALLOW_UNSIGNED_MANIFESTS" android:value="true"/>
```

### No Updates Available (404)

1. Check that `project` query param matches your app slug
2. Verify there's a `released` upload for your runtime version and channel
3. Check the `/uploads` endpoint to see upload statuses

## Contributing

Feel free to fork, customize, and send back PRs!

## License

MIT

---

*Originally forked from [umbertoghio/self-hosted-expo-updates-server](https://github.com/umbertoghio/self-hosted-expo-updates-server), rewritten for Cloudflare Workers.*
