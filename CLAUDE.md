# CLAUDE.md

This file provides guidance for AI assistants working with this codebase.

## Project Overview

Self Hosted Expo Updates Server is a complete solution for managing Expo OTA (Over-The-Air) updates. It allows developers to self-host their own update server with a web dashboard for managing updates, rollbacks, and monitoring client downloads.

**Key Features:**
- Manage multiple Expo apps
- Support for multiple runtime versions and release channels
- Secure update publishing with code signing
- Rollback capability
- Real-time client update monitoring
- Self-signed certificate generation

## Architecture

The project consists of three main components:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web (React)   │────▶│  API (Node.js)  │────▶│    MongoDB      │
│   Port 4000     │     │   Port 3000     │     │   Port 27017    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  File Storage   │
                        │ /updates        │
                        │ /uploads        │
                        └─────────────────┘
```

### API Server (FeathersJS + Express)
- **Framework**: FeathersJS v4 on Express
- **Entry point**: `API/src/index.js`
- **Configuration**: `API/config/` (uses node-config)
- **Database**: MongoDB v4.2.2

### Web Dashboard (React + Vite)
- **Framework**: React 17 with Vite
- **Entry point**: `Web/src/index.jsx`
- **State management**: react-capsule + react-query
- **UI Library**: PrimeReact with Font Awesome icons
- **Routing**: React Router v6

## Directory Structure

```
├── API/                      # Backend server
│   ├── config/               # Configuration files (node-config)
│   │   ├── default.json      # Default settings
│   │   ├── production.json   # Production overrides
│   │   └── custom-environment-variables.json  # Env var mapping
│   ├── public/               # Static files + publish script
│   ├── src/
│   │   ├── hooks/            # FeathersJS hooks
│   │   │   ├── app.js        # Application-level hooks
│   │   │   ├── error.js      # Error handling hooks
│   │   │   └── security.js   # Authentication/authorization hooks
│   │   ├── modules/          # Core modules
│   │   │   ├── expo/         # Expo-specific logic
│   │   │   │   ├── asset.js  # Asset handling
│   │   │   │   ├── certs.js  # Certificate generation
│   │   │   │   ├── helpers.js # Utility functions
│   │   │   │   ├── manifest.js # Manifest generation
│   │   │   │   └── request.js # Request parsing
│   │   │   ├── channels.js   # Socket.io channels
│   │   │   ├── express.config.js
│   │   │   ├── feathers.config.js
│   │   │   ├── logger.js     # Pino logger
│   │   │   └── mongodb.js    # Database connection
│   │   ├── services/         # API endpoints
│   │   │   ├── api.js        # Main Expo API (manifest/assets)
│   │   │   ├── apps.js       # App management
│   │   │   ├── authentication.js
│   │   │   ├── clients.js    # Client device tracking
│   │   │   ├── messages.js   # Real-time messaging
│   │   │   ├── stats.js      # Statistics
│   │   │   ├── status.js     # Server status
│   │   │   ├── upload.js     # File upload handling
│   │   │   ├── uploads.js    # Upload records
│   │   │   └── users.js      # User management
│   │   └── index.js          # Server entry point
│   └── Dockerfile
│
├── Web/                      # Frontend dashboard
│   ├── deploy/               # Nginx and deployment configs
│   ├── public/               # Static assets
│   ├── src/
│   │   ├── Components/       # Reusable UI components
│   │   │   ├── Common/       # Button, Card, Input, etc.
│   │   │   └── Layout/       # TopMenu, Background, etc.
│   │   ├── Pages/            # Route components
│   │   │   ├── App/          # App detail pages
│   │   │   ├── Home/         # Dashboard home
│   │   │   ├── Login.jsx
│   │   │   └── NewApp.jsx
│   │   ├── Services/         # API client
│   │   │   ├── FeathersClient.js  # Socket.io client
│   │   │   └── QueryCache.js      # React Query config
│   │   ├── State/            # State management
│   │   └── index.jsx         # App entry point
│   ├── vite.config.js
│   └── Dockerfile
│
├── Docker/                   # Docker compose files
│   ├── development/          # Dev environment
│   └── production/           # Production setup
│
├── ExampleEjected/           # Example ejected Expo app
├── ExampleManaged/           # Example managed Expo app
└── Builds/                   # Build artifacts (gitignored)
```

## Development Workflow

### Quick Start
```bash
# Install root dependencies
yarn

# Start development environment (API + Web + MongoDB)
yarn dev:run

# Stop development environment
yarn dev:stop
```

This starts:
- API server at `http://localhost:3000`
- Web dashboard at `http://localhost:4000`
- MongoDB at `localhost:27017`

**Default credentials**: admin / devserver

### Running Individual Components

**API Server (with hot reload):**
```bash
cd API
yarn
yarn start  # Uses nodemon with --inspect
```

**Web Dashboard:**
```bash
cd Web
yarn
yarn start  # Vite dev server on port 4000
```

## Key Conventions

### Code Style
- **Indentation**: 2 spaces
- **Line endings**: LF (Unix)
- **Linting**: StandardJS
- **Trailing commas**: Avoided
- **Semicolons**: Required in API, optional in Web

### API Service Pattern

Services in `API/src/services/` follow this pattern:

```javascript
const s = require('../hooks/security')

module.exports = {
  name: 'serviceName',         // URL path: /serviceName
  noBsonIDs: false,            // Use string IDs instead of ObjectId
  createService: null,         // Custom service class (optional)
  middleware: null,            // Express middleware (optional)
  hooks: {
    before: {
      all: s.defaultSecurity(), // JWT auth by default
      find: [],
      get: [],
      create: [],
      update: [],
      patch: [],
      remove: []
    },
    after: { /* ... */ }
  }
}
```

### Security Hooks
- `s.defaultSecurity()` - JWT authentication + prevent global updates
- `s.methodNotAllowed` - Block specific HTTP methods
- `s.preventGlobalUpdates` - Require entity ID for updates/patches/deletes

### React Component Structure

Components use functional style with hooks:
```jsx
import React from 'react'
import { useQuery } from 'react-query'
import { FC } from '../Services'

function MyComponent() {
  const { data } = useQuery('key', () => FC.service('endpoint').find())
  return <div>{/* ... */}</div>
}
```

## Environment Variables

### API Server
| Variable | Description | Default |
|----------|-------------|---------|
| `MONGO_CONN` | MongoDB connection string | Required |
| `FEATHERS_AUTH_SECRET` | JWT signing secret | Required |
| `ADMIN_PASSWORD` | Initial admin password | `admin` |
| `UPLOAD_KEY` | Key for publish script auth | Required |
| `PUBLIC_URL` | Public server URL | `http://localhost:3000` |
| `DASBHOARD_THROTTLE_MSEC` | Dashboard refresh throttle | `5000` |
| `NODE_ENV` | Environment mode | `development` |
| `TZ` | Timezone | `Europe/Rome` |

### Web Dashboard
| Variable | Description | Default |
|----------|-------------|---------|
| `API_BASE_URL` | Backend API URL | `http://localhost:3000` |
| `ENVIRONMENT` | Environment name | `development` |

## API Endpoints

### Public Endpoints (No Auth)
- `GET /api/manifest` - Fetch update manifest (Expo client)
- `GET /api/assets` - Fetch update assets (Expo client)
- `GET /status` - Server health check

### Authenticated Endpoints
- `/apps` - CRUD for managed applications
- `/uploads` - Upload records management
- `/upload` - File upload (multipart, requires upload-key header)
- `/clients` - Client device tracking
- `/stats` - Usage statistics
- `/users` - User management
- `/authentication` - Login/logout

## Docker Deployment

### Development
```bash
cd Docker/development
docker-compose up --build
```

### Production
1. Copy `Docker/production/` to your server
2. Edit `docker-compose.yml`:
   - Set `FEATHERS_AUTH_SECRET`
   - Set `ADMIN_PASSWORD`
   - Set `UPLOAD_KEY`
   - Set `PUBLIC_URL` to your domain
   - Set MongoDB credentials in `mongoinit/init.js`
3. Run `docker-compose up -d`

## Publishing Updates

Use the provided script or create your own:

```bash
# Download script from server
curl -o publish.sh http://your-server:3000/expo-publish-selfhosted.sh

# Publish an update
./publish.sh <release-channel> <app-path> <upload-key> <server-url>

# Example
./publish.sh staging ./MyApp abc123 https://updates.example.com
```

The script:
1. Runs `expo export` to generate update bundle
2. Adds `app.json` and `package.json` to the bundle
3. Zips the bundle
4. POSTs to `/upload` with required headers

## Testing

No automated test suite is currently configured. Manual testing through the web dashboard or API clients.

## Common Tasks

### Adding a New API Service
1. Create `API/src/services/newservice.js`
2. Export with `name`, `hooks`, and optionally `createService`
3. Service auto-registers on startup

### Adding a New Web Page
1. Create component in `Web/src/Pages/`
2. Add route in `Web/src/index.jsx`
3. Optionally add to `Web/src/Components/Layout/MenuItems.js`

### Modifying Database Schema
No migrations - MongoDB is schema-less. Update service hooks for validation.

## Troubleshooting

### Admin User Not Created
Restart API container after MongoDB is fully initialized:
```bash
docker-compose restart api
```

### Certificate Issues During Development
For Expo SDK >= 49, start dev server with:
```bash
npx expo start --private-key-path path/to/key.pem
```

### WebSocket Connection Fails
Check that `API_BASE_URL` in Web matches the accessible API server URL.
