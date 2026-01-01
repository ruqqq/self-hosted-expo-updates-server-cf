# Cloudflare Workers Migration Feasibility Study

## Executive Summary

**Verdict: FEASIBLE with architectural changes**

The migration is viable with the following key decisions:
- ✅ **Web Dashboard**: Deploy as static assets via Workers Sites/Pages
- ✅ **API Server**: Rewrite using Hono + D1 + R2
- ⚠️ **Real-time Features**: Replace Socket.io with polling or Durable Objects
- ✅ **Expo Protocol**: Fully achievable with 1:1 parity

---

## Current Architecture vs Target Architecture

```
CURRENT                                    TARGET (Cloudflare)
┌─────────────────┐                       ┌─────────────────────────┐
│  Web (React)    │                       │  Workers Sites/Pages    │
│  Port 4000      │                       │  (Static Assets)        │
└────────┬────────┘                       └───────────┬─────────────┘
         │ Socket.io                                  │ REST/Polling
         ▼                                            ▼
┌─────────────────┐                       ┌─────────────────────────┐
│  API (Feathers) │                       │  Hono Worker            │
│  Port 3000      │                       │  (Edge Runtime)         │
└────────┬────────┘                       └───────────┬─────────────┘
         │                                            │
    ┌────┴────┐                               ┌───────┴───────┐
    ▼         ▼                               ▼               ▼
┌───────┐ ┌───────┐                    ┌──────────┐    ┌──────────┐
│MongoDB│ │  FS   │                    │    D1    │    │    R2    │
│       │ │/updates│                   │ (SQLite) │    │ (S3-like)│
└───────┘ └───────┘                    └──────────┘    └──────────┘
```

---

## Component Analysis

### 1. Web Dashboard (LOW EFFORT)

**Current State**: React 17 SPA with Vite, connects via Socket.io

**Migration Path**:
1. Build as static assets (`yarn vite build`)
2. Deploy to Workers Sites or Cloudflare Pages
3. **Key Change**: Replace Socket.io with REST API + polling for real-time updates

**Required Changes**:
- Replace `FeathersClient.js` Socket.io transport with fetch-based REST
- Add polling mechanism for dashboard updates (or accept manual refresh)
- Update environment injection for `API_BASE_URL`

**Effort**: ~1-2 days

---

### 2. API Server (HIGH EFFORT - Complete Rewrite)

#### 2.1 Framework: Hono

**Why Hono**:
- Built for edge runtimes (Workers, Deno, Bun)
- Express-like API (easy mental model from current codebase)
- Built-in middleware support
- TypeScript-first
- Multipart form handling support

**Example Structure**:
```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { jwt } from 'hono/jwt'

const app = new Hono<{ Bindings: Env }>()

// Public routes
app.get('/api/manifest', handleManifest)
app.get('/api/assets', handleAssets)
app.get('/status', handleStatus)

// Protected routes
app.use('/apps/*', jwt({ secret: env.JWT_SECRET }))
app.route('/apps', appsRouter)

export default app
```

#### 2.2 Database: D1 with Drizzle ORM

**Schema Translation** (MongoDB → D1/SQLite):

```typescript
// drizzle/schema.ts
import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),  // bcrypt hash
  role: text('role').default('user'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
})

export const apps = sqliteTable('apps', {
  id: text('id').primaryKey(),  // app slug
  name: text('name'),
  privateKey: text('private_key'),  // RSA key for code signing
  createdAt: integer('created_at', { mode: 'timestamp' }),
})

export const uploads = sqliteTable('uploads', {
  id: text('id').primaryKey(),
  project: text('project').notNull().references(() => apps.id),
  version: text('version').notNull(),
  releaseChannel: text('release_channel').notNull(),
  status: text('status').default('ready'),  // ready | released | obsolete
  r2Key: text('r2_key').notNull(),  // R2 object key for the update bundle
  metadataJson: text('metadata_json'),  // Cached metadata.json content
  appJson: text('app_json'),  // Cached app.json expo field
  updateId: text('update_id'),
  gitBranch: text('git_branch'),
  gitCommit: text('git_commit'),
  size: integer('size'),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  releasedAt: integer('released_at', { mode: 'timestamp' }),
})

// Indexes for common queries
export const uploadsProjectVersionIdx = index('uploads_project_version_idx')
  .on(uploads.project, uploads.version, uploads.releaseChannel, uploads.status)

export const clients = sqliteTable('clients', {
  id: text('id').primaryKey(),  // EAS client ID
  project: text('project').notNull(),
  version: text('version'),
  platform: text('platform'),
  releaseChannel: text('release_channel'),
  embeddedUpdate: text('embedded_update'),
  currentUpdate: text('current_update'),
  updateCount: integer('update_count').default(0),
  firstSeen: integer('first_seen', { mode: 'timestamp' }),
  lastSeen: integer('last_seen', { mode: 'timestamp' }),
})
```

#### 2.3 File Storage: R2

**Storage Strategy**:

```
R2 Bucket Structure:
├── uploads/
│   └── {uploadId}.zip           # Original upload (can be deleted after extraction)
└── updates/
    └── {project}/
        └── {version}/
            └── {uploadId}/
                ├── metadata.json
                ├── bundles/
                │   ├── ios-{hash}.js
                │   └── android-{hash}.js
                └── assets/
                    ├── {hash}.png
                    └── {hash}.ttf
```

**Key Operations**:
```typescript
// Upload handling
await env.R2.put(`updates/${project}/${version}/${id}/metadata.json`, metadata)
await env.R2.put(`updates/${project}/${version}/${id}/bundles/ios.js`, bundle)

// Asset serving
const asset = await env.R2.get(assetPath)
return new Response(asset.body, {
  headers: { 'Content-Type': contentType }
})
```

---

## Challenges & Solutions

### Challenge 1: ZIP Extraction (HIGH)

**Problem**: Workers can't do synchronous file I/O or stream extraction easily.

**Solutions**:

**Option A: Client-side extraction (Recommended)**
- Change publish script to upload pre-extracted files
- Each file uploaded as separate R2 object
- No server-side extraction needed

```bash
# New publish flow
expo export --output-dir ./dist
# Upload each file individually or as multipart
for file in ./dist/**/*; do
  curl -X PUT "$SERVER/api/upload-asset" \
    -H "path: ${file#./dist/}" \
    -d @"$file"
done
```

**Option B: Durable Objects for async processing**
- Accept ZIP upload to R2
- Durable Object processes in background
- Uses streaming unzip library (fflate)

**Option C: External extraction service**
- Upload ZIP to R2
- Trigger external Lambda/Cloud Function for extraction
- Webhook callback when complete

**Recommendation**: Option A - simplest, most reliable, no Workers limitations

### Challenge 2: Multipart Form Upload (MEDIUM)

**Problem**: Current upload uses multer + feathers-blob (Node.js specific)

**Solution**: Use Hono's built-in multipart parser or `@cloudflare/workers-types`

```typescript
import { Hono } from 'hono'

app.post('/upload', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('file') as File

  // Stream directly to R2
  await c.env.R2.put(`uploads/${id}`, file.stream())

  return c.json({ id })
})
```

### Challenge 3: Multipart Response for Manifest (MEDIUM)

**Problem**: Expo expects `multipart/mixed` response format

**Solution**: Manual construction (straightforward)

```typescript
function createMultipartResponse(manifest: object, extensions: object, signature?: string) {
  const boundary = `----FormBoundary${crypto.randomUUID()}`

  let body = `--${boundary}\r\n`
  body += 'Content-Type: application/json; charset=utf-8\r\n'
  body += 'Content-Disposition: form-data; name="manifest"\r\n'
  if (signature) {
    body += `expo-signature: ${signature}\r\n`
  }
  body += '\r\n'
  body += JSON.stringify(manifest)
  body += `\r\n--${boundary}\r\n`
  body += 'Content-Type: application/json\r\n'
  body += 'Content-Disposition: form-data; name="extensions"\r\n\r\n'
  body += JSON.stringify(extensions)
  body += `\r\n--${boundary}--\r\n`

  return new Response(body, {
    headers: {
      'Content-Type': `multipart/mixed; boundary=${boundary}`,
      'expo-protocol-version': '0',
      'expo-sfv-version': '0',
      'cache-control': 'private, max-age=0'
    }
  })
}
```

### Challenge 4: Code Signing (LOW)

**Problem**: Uses `node-forge` for RSA-SHA256 signing

**Solution**: Use Web Crypto API (available in Workers)

```typescript
async function signManifest(manifest: string, privateKeyPem: string): Promise<string> {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(manifest)
  )

  return `sig="${btoa(String.fromCharCode(...new Uint8Array(signature)))}", keyid="main"`
}
```

### Challenge 5: Real-time Updates (MEDIUM)

**Problem**: Socket.io requires persistent WebSocket server

**Solutions**:

**Option A: Polling (Simple)**
- Dashboard polls `/stats` endpoint every 5-10 seconds
- Simple, no additional infrastructure

**Option B: Durable Objects WebSocket (Complex)**
- Durable Object maintains WebSocket connections
- Publishes updates to connected clients
- More complex, but real-time

**Option C: Cloudflare Pub/Sub (Future)**
- Cloudflare's upcoming Pub/Sub service
- Not GA yet

**Recommendation**: Start with Option A, upgrade to B if needed

### Challenge 6: Authentication (LOW)

**Problem**: Feathers.js authentication is framework-specific

**Solution**: Standard JWT with Hono middleware

```typescript
import { jwt } from 'hono/jwt'
import { sign, verify } from 'hono/utils/jwt'

// Login endpoint
app.post('/authentication', async (c) => {
  const { username, password } = await c.req.json()
  const user = await db.query.users.findFirst({
    where: eq(users.username, username)
  })

  if (!user || !await bcrypt.compare(password, user.password)) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const token = await sign({ sub: user.id, role: user.role }, c.env.JWT_SECRET)
  return c.json({ accessToken: token, user: { id: user.id, username: user.username } })
})

// Protected routes
app.use('/api/*', jwt({ secret: env.JWT_SECRET }))
```

### Challenge 7: Password Hashing (LOW)

**Problem**: bcrypt is not available in Workers (native module)

**Solution**: Use `bcryptjs` (pure JS) or Argon2 via WebAssembly

```typescript
import bcrypt from 'bcryptjs'

// Works in Workers environment
const hash = await bcrypt.hash(password, 10)
const isValid = await bcrypt.compare(password, hash)
```

---

## Expo Protocol Parity Checklist

| Feature | Current | Workers Implementation | Status |
|---------|---------|----------------------|--------|
| Manifest endpoint | GET /api/manifest | Hono route | ✅ Easy |
| Multipart manifest response | FormData → Buffer | Manual construction | ✅ Easy |
| Asset endpoint | GET /api/assets | R2.get() + Response | ✅ Easy |
| Request header parsing | expo-* headers | c.req.header() | ✅ Easy |
| SHA256 + Base64URL hash | crypto module | Web Crypto API | ✅ Easy |
| MD5 asset keys | crypto module | crypto.subtle (fallback lib) | ⚠️ Need lib |
| RSA-SHA256 signing | node-forge | Web Crypto API | ✅ Easy |
| Certificate generation | node-forge | Web Crypto + ASN.1 lib | ⚠️ Need lib |
| Client tracking | MongoDB upsert | D1 upsert | ✅ Easy |
| Upload processing | ZIP extraction | Pre-extracted upload | 🔄 Changed |

**MD5 Note**: Web Crypto doesn't support MD5. Use a lightweight library like `js-md5`.

---

## Proposed Project Structure

```
/
├── worker/
│   ├── src/
│   │   ├── index.ts              # Main entry point
│   │   ├── routes/
│   │   │   ├── api.ts            # Expo manifest/assets
│   │   │   ├── apps.ts           # App management
│   │   │   ├── auth.ts           # Authentication
│   │   │   ├── clients.ts        # Client tracking
│   │   │   ├── stats.ts          # Statistics
│   │   │   ├── uploads.ts        # Upload management
│   │   │   └── utils.ts          # Utility endpoints
│   │   ├── services/
│   │   │   ├── manifest.ts       # Manifest generation
│   │   │   ├── signing.ts        # Code signing
│   │   │   └── assets.ts         # Asset handling
│   │   ├── db/
│   │   │   ├── schema.ts         # Drizzle schema
│   │   │   └── index.ts          # DB client
│   │   ├── middleware/
│   │   │   ├── auth.ts           # JWT validation
│   │   │   └── upload.ts         # Upload key validation
│   │   └── types.ts              # TypeScript types
│   ├── drizzle/
│   │   └── migrations/           # D1 migrations
│   ├── wrangler.toml
│   └── package.json
│
├── web/                          # React dashboard (unchanged mostly)
│   ├── src/
│   │   ├── Services/
│   │   │   └── ApiClient.ts      # NEW: REST-based client
│   │   └── ...
│   └── ...
│
├── scripts/
│   └── expo-publish-cf.sh        # Updated publish script
│
└── package.json
```

---

## Migration Steps (Recommended Order)

### Phase 1: Core Infrastructure (Week 1)
1. Set up Hono project with TypeScript
2. Configure D1 database and Drizzle ORM
3. Create database schema and migrations
4. Set up R2 bucket bindings

### Phase 2: Public API (Week 1-2)
1. Implement `/api/manifest` endpoint
2. Implement `/api/assets` endpoint
3. Implement `/status` endpoint
4. Test with Expo client

### Phase 3: Upload Flow (Week 2)
1. Create new publish script (pre-extracted files)
2. Implement `/upload` endpoint for file-by-file upload
3. Implement upload metadata creation

### Phase 4: Dashboard API (Week 2-3)
1. Implement authentication
2. Implement `/apps` CRUD
3. Implement `/uploads` management
4. Implement `/clients` and `/stats`
5. Implement release/rollback utilities

### Phase 5: Web Dashboard (Week 3)
1. Replace Socket.io with REST client
2. Add polling for real-time updates
3. Build and deploy to Workers Sites

### Phase 6: Code Signing (Week 3)
1. Implement RSA-SHA256 signing with Web Crypto
2. Implement certificate generation (or use pre-generated)
3. Test with signed updates

### Phase 7: Testing & Documentation (Week 4)
1. End-to-end testing with Expo apps
2. Performance testing
3. Documentation updates

---

## Cost Considerations

| Resource | Free Tier | Paid Tier | Expected Usage |
|----------|-----------|-----------|----------------|
| Workers Requests | 100K/day | $0.50/million | Low-Medium |
| D1 Reads | 5M/day | $0.001/million | Low |
| D1 Writes | 100K/day | $1.00/million | Low |
| R2 Storage | 10GB | $0.015/GB | Medium |
| R2 Operations | 10M/month | $4.50/million | Low-Medium |

For a small-medium deployment, this should fit comfortably in the free tier or cost < $5/month.

---

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Workers request timeout (30s) | Medium | Low | Pre-extract uploads, lazy asset loading |
| D1 size limits (10GB) | Medium | Low | Prune old uploads, store only metadata |
| R2 latency for assets | Low | Medium | Use Workers KV for frequently accessed assets |
| Expo protocol changes | High | Low | Monitor Expo updates, abstract protocol layer |
| bcrypt compatibility | Low | Low | Use bcryptjs (pure JS) |

---

## Conclusion

**The migration is feasible and recommended** with the following key changes:

1. **Rewrite API** using Hono + D1 + R2 (required)
2. **Change upload flow** to pre-extracted files (simplifies architecture)
3. **Replace real-time** with polling (acceptable trade-off)
4. **Keep Web SPA** mostly unchanged (just switch to REST)

The result will be a globally distributed, serverless, low-cost deployment with excellent cold-start performance.

**Estimated Total Effort**: 3-4 weeks for a complete migration
