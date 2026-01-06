# CLAUDE.md

This file provides guidance for AI assistants working with this codebase.

## Project Overview

Self Hosted Expo Updates Server is a complete solution for managing Expo OTA (Over-The-Air) updates, running on Cloudflare Workers with D1 (SQLite) and R2 (Object Storage).

**Key Features:**
- Manage multiple Expo apps
- Support for multiple runtime versions and release channels
- Platform-specific updates (iOS-only, Android-only, or both)
- Secure update publishing with code signing
- Rollback capability
- Client device tracking and analytics
- Self-signed certificate generation
- Edge deployment via Cloudflare's global network

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Workers                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │
│  │   Hono Router   │  │  HTML Dashboard │  │   API       │  │
│  │   (src/index)   │  │  (dashboard/)   │  │  (routes/)  │  │
│  └────────┬────────┘  └─────────────────┘  └──────┬──────┘  │
│           │                                        │         │
│  ┌────────▼────────┐                     ┌────────▼────────┐│
│  │   D1 Database   │                     │   R2 Storage    ││
│  │   (SQLite)      │                     │   (Assets)      ││
│  └─────────────────┘                     └─────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack
- **Runtime**: Cloudflare Workers (Edge)
- **Framework**: Hono (TypeScript)
- **Database**: D1 (SQLite) with Drizzle ORM
- **Storage**: R2 (S3-compatible object storage)
- **Dashboard**: Server-rendered HTML with htm.js
- **Authentication**: JWT tokens

## Directory Structure

```
├── worker/                   # Cloudflare Worker implementation
│   ├── src/
│   │   ├── index.ts          # Worker entry point (Hono app)
│   │   ├── types.ts          # TypeScript type definitions
│   │   ├── db/
│   │   │   └── schema.ts     # Drizzle ORM schema
│   │   ├── routes/
│   │   │   ├── api.ts        # Expo manifest/assets endpoints
│   │   │   ├── auth.ts       # Authentication routes
│   │   │   ├── apps.ts       # App CRUD operations
│   │   │   ├── uploads.ts    # Upload management
│   │   │   ├── clients.ts    # Client device tracking
│   │   │   ├── stats.ts      # Statistics endpoints
│   │   │   └── utils.ts      # Utility routes
│   │   ├── services/
│   │   │   ├── manifest.ts   # Manifest generation logic
│   │   │   ├── helpers.ts    # Helper utilities
│   │   │   └── md5.ts        # MD5 hashing
│   │   └── middleware/
│   │       └── auth.ts       # JWT authentication middleware
│   ├── dashboard/            # HTML dashboard (htm.js)
│   │   ├── index.html        # Main HTML template
│   │   ├── app.js            # Dashboard app initialization
│   │   ├── api.js            # Dashboard API client
│   │   ├── pages/            # Page components
│   │   └── components/       # Reusable UI components
│   ├── migrations/           # D1 database migrations (Drizzle)
│   ├── scripts/
│   │   └── e2e-test.sh       # End-to-end test suite
│   ├── wrangler.sample.toml  # Example Wrangler config
│   ├── drizzle.config.ts     # Drizzle ORM config
│   ├── package.json
│   └── tsconfig.json
│
├── ExampleEjected/           # Example ejected Expo app
├── ExampleManaged/           # Example managed Expo app
├── package.json              # Root package.json (scripts proxy to worker)
└── README.md                 # Main documentation
```

## Development Workflow

### Quick Start

```bash
# Install dependencies
cd worker
npm install

# Copy and configure wrangler.toml
cp wrangler.sample.toml wrangler.toml
# Edit wrangler.toml with your D1 database_id

# Set up local environment
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your secrets

# Apply database migrations locally
npm run db:migrate:local

# Start dev server
npm run dev
```

Visit `http://localhost:3000` to access the dashboard.

**Default credentials**: admin / (your ADMIN_PASSWORD from .dev.vars)

### Running Tests

```bash
# Unit tests
npm test

# E2E tests (requires running dev server)
UPLOAD_KEY=your-key npm run test:e2e
```

## Key Conventions

### Code Style
- **Language**: TypeScript
- **Indentation**: 2 spaces
- **Linting**: oxlint
- **Formatting**: oxfmt (Prettier-compatible)
- **Type checking**: tsgo (fast TypeScript checker)

### Route Pattern

Routes in `worker/src/routes/` follow this pattern:

```typescript
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';

const app = new Hono<{ Bindings: Env }>();

// Public endpoint
app.get('/public', async (c) => {
  return c.json({ data: 'public' });
});

// Protected endpoint
app.get('/protected', authMiddleware, async (c) => {
  const user = c.get('user');
  return c.json({ data: 'protected', user });
});

export default app;
```

### Database Operations

Uses Drizzle ORM with D1:

```typescript
import { drizzle } from 'drizzle-orm/d1';
import { apps } from '../db/schema';

const db = drizzle(c.env.DB);
const allApps = await db.select().from(apps);
```

## Environment Variables

### Development (.dev.vars)

```bash
JWT_SECRET=your-jwt-secret        # openssl rand -base64 32
UPLOAD_KEY=your-upload-key        # openssl rand -hex 16
ADMIN_PASSWORD=your-admin-password
```

### Production

Set via `wrangler secret put`:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put UPLOAD_KEY
npx wrangler secret put ADMIN_PASSWORD
```

### wrangler.toml Configuration

```toml
[vars]
PUBLIC_URL = "https://your-worker.workers.dev"

[[d1_databases]]
binding = "DB"
database_name = "expo-updates"
database_id = "your-database-id"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "expo-updates"
```

## API Endpoints

### Public Endpoints (No Auth)
- `GET /status` - Health check
- `GET /api/manifest` - Expo update manifest
- `GET /api/assets` - Asset files from R2

### Protected Endpoints (JWT Required)
- `GET/POST /apps` - List/create apps
- `GET/PATCH/DELETE /apps/:id` - Manage app
- `GET /uploads` - List uploads
- `GET/PATCH/DELETE /uploads/:id` - Manage upload
- `GET /clients` - List client devices
- `GET /stats/:project` - Project statistics
- `POST /utils/release` - Release an upload
- `POST /utils/rollback` - Rollback to previous
- `POST /utils/generate-certificate` - Generate signing keys

### Upload Endpoint (Upload Key Required)
- `POST /upload` - Upload new update bundle

## Common Tasks

### Adding a New Route

1. Create `worker/src/routes/newroute.ts`
2. Export a Hono app with your routes
3. Import and mount in `worker/src/index.ts`

### Database Schema Changes

1. Modify `worker/src/db/schema.ts`
2. Generate migration: `npm run db:generate`
3. Apply migration: `npm run db:migrate`

### Deployment

```bash
cd worker
npm run deploy
```

## Tooling

| Tool | Purpose | Command |
|------|---------|---------|
| [tsgo](https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/) | Type checking | `npm run typecheck` |
| [oxlint](https://oxc.rs/) | Linting | `npm run lint` |
| [oxfmt](https://oxc.rs/docs/guide/usage/formatter) | Formatting | `npm run format` |
| [Drizzle](https://orm.drizzle.team/) | ORM & migrations | `npm run db:*` |
| [Vitest](https://vitest.dev/) | Unit testing | `npm test` |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | CF deployment | `npm run dev/deploy` |

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

### Local database reset
```bash
rm -rf worker/.wrangler/state
npm run db:migrate:local
```

### Certificate Issues During Development
For Expo SDK >= 49, start dev server with:
```bash
npx expo start --private-key-path path/to/key.pem
```
