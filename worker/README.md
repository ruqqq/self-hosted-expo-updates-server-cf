# Expo Updates Worker

Self-Hosted Expo Updates Server running on Cloudflare Workers with D1 (SQLite) and R2 (Object Storage).

## Prerequisites

- Node.js >= 18.0.0
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (installed as dev dependency)
- Cloudflare account (for deployment)

## Quick Start

### 1. Install Dependencies

```bash
cd worker
npm install
```

### 2. Set Up Environment Variables

Copy the example environment file:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with your secrets:

```bash
# Generate a JWT secret
openssl rand -base64 32

# Generate an upload key
openssl rand -hex 16
```

### 3. Create Local D1 Database

```bash
# Generate database migrations from schema
npm run db:generate

# Apply migrations to local database
npm run db:migrate:local
```

### 4. Start Development Server

```bash
npm run dev
```

The server will start at `http://localhost:3000`.

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local development server |
| `npm run typecheck` | Run TypeScript type checking with tsgo |
| `npm run lint` | Run oxlint linter |
| `npm run lint:fix` | Run oxlint with auto-fix |
| `npm run format` | Format code with oxfmt |
| `npm run format:check` | Check code formatting |
| `npm run check` | Run all checks (typecheck + lint + format) |
| `npm run test` | Run tests with Vitest |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate:local` | Apply migrations to local D1 |
| `npm run db:studio` | Open Drizzle Studio for DB inspection |

## Deployment

### 1. Create Cloudflare Resources

First, create the required D1 database and R2 bucket in your Cloudflare dashboard or via Wrangler:

```bash
# Create D1 database
npx wrangler d1 create expo-updates

# Create R2 bucket
npx wrangler r2 bucket create expo-updates
```

### 2. Update wrangler.toml

Update `wrangler.toml` with your database ID:

```toml
[[d1_databases]]
binding = "DB"
database_name = "expo-updates"
database_id = "YOUR_DATABASE_ID_HERE"  # Replace with actual ID
```

### 3. Set Production Secrets

```bash
# Set JWT secret
npx wrangler secret put JWT_SECRET

# Set upload key
npx wrangler secret put UPLOAD_KEY

# Set admin password
npx wrangler secret put ADMIN_PASSWORD
```

### 4. Apply Database Migrations

```bash
npm run db:migrate
```

### 5. Deploy

```bash
# Deploy to default environment
npm run deploy

# Deploy to staging
npm run deploy:staging

# Deploy to production
npm run deploy:production
```

## Project Structure

```
worker/
├── src/
│   ├── index.ts          # Main entry point (Hono app)
│   ├── types.ts          # TypeScript types
│   ├── db/
│   │   └── schema.ts     # Drizzle ORM schema
│   ├── routes/
│   │   ├── api.ts        # Expo manifest/assets (public)
│   │   ├── auth.ts       # Authentication
│   │   ├── apps.ts       # App management
│   │   ├── uploads.ts    # Upload management
│   │   ├── clients.ts    # Client tracking
│   │   ├── stats.ts      # Statistics
│   │   └── utils.ts      # Utility endpoints
│   ├── services/
│   │   └── manifest.ts   # Manifest generation & signing
│   └── middleware/
│       └── auth.ts       # Auth middleware
├── drizzle/
│   └── migrations/       # Database migrations
├── wrangler.toml         # Cloudflare Worker config
├── tsconfig.json         # TypeScript config
├── oxlint.json           # Linter config
├── .prettierrc           # Formatter config (for oxfmt)
├── drizzle.config.ts     # Drizzle Kit config
└── package.json
```

## API Endpoints

### Public Endpoints (No Auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/status` | Health check |
| `GET` | `/api/manifest` | Expo update manifest |
| `GET` | `/api/assets` | Asset files |

### Protected Endpoints (JWT Required)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/authentication` | Login |
| `GET/POST` | `/apps` | App management |
| `GET/POST/PATCH/DELETE` | `/uploads` | Upload management |
| `GET` | `/clients` | Client device tracking |
| `GET` | `/stats/:project` | Project statistics |
| `POST` | `/utils/release` | Release an update |
| `POST` | `/utils/rollback` | Rollback to previous update |

### Upload Endpoint (Upload Key Required)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Upload new update |

## Publishing Updates

Use the provided publish script or create your own:

```bash
# Example publish command
curl -X POST "https://your-worker.workers.dev/upload" \
  -H "project: my-app" \
  -H "version: 1.0.0" \
  -H "release-channel: production" \
  -H "upload-key: your-upload-key" \
  -H "git-branch: main" \
  -H "git-commit: abc123" \
  -F "metadata.json=@dist/metadata.json" \
  -F "bundles/ios.js=@dist/bundles/ios-xxx.js" \
  -F "bundles/android.js=@dist/bundles/android-xxx.js" \
  -F "app.json=@app.json"
```

## Environment Variables

### Development (.dev.vars)

| Variable | Description | Example |
|----------|-------------|---------|
| `JWT_SECRET` | Secret for signing JWT tokens | `openssl rand -base64 32` |
| `UPLOAD_KEY` | Key for publish script auth | `openssl rand -hex 16` |
| `ADMIN_PASSWORD` | Initial admin password | `admin123` |

### Production (wrangler.toml vars)

| Variable | Description |
|----------|-------------|
| `PUBLIC_URL` | Public URL of your worker |

### Production Secrets (wrangler secret)

| Secret | Description |
|--------|-------------|
| `JWT_SECRET` | Secret for signing JWT tokens |
| `UPLOAD_KEY` | Key for publish script auth |
| `ADMIN_PASSWORD` | Initial admin password |

## Tooling

This project uses modern, fast tooling:

- **[tsgo](https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/)** - Microsoft's Go-based TypeScript compiler (~10x faster)
- **[oxlint](https://oxc.rs/)** - Rust-based linter (~50-100x faster than ESLint)
- **[oxfmt](https://oxc.rs/docs/guide/usage/formatter)** - Rust-based formatter (~30x faster than Prettier)
- **[Drizzle ORM](https://orm.drizzle.team/)** - TypeScript ORM for D1/SQLite
- **[Hono](https://hono.dev/)** - Fast web framework for edge runtimes
- **[Vitest](https://vitest.dev/)** - Fast test runner

## Troubleshooting

### "Database not found" error

Make sure you've created the D1 database and updated `wrangler.toml`:

```bash
npx wrangler d1 create expo-updates
# Copy the database_id to wrangler.toml
```

### "R2 bucket not found" error

Create the R2 bucket:

```bash
npx wrangler r2 bucket create expo-updates
```

### Type errors with Cloudflare types

Make sure `@cloudflare/workers-types` is installed and included in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"]
  }
}
```

### Local development with D1

For local development, Wrangler uses a local SQLite database. Data is stored in `.wrangler/state/`.

To reset the local database:

```bash
rm -rf .wrangler/state
npm run db:migrate:local
```

## License

MIT
