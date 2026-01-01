/**
 * Self-Hosted Expo Updates Server - Cloudflare Worker
 *
 * Main entry point for the Hono-based API server.
 * Replaces the original FeathersJS + Express server.
 */

import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { prettyJSON } from "hono/pretty-json"
import { secureHeaders } from "hono/secure-headers"

import type { Env } from "./types"

// Route imports
import { apiRoutes } from "./routes/api"
import { authRoutes } from "./routes/auth"
import { appsRoutes } from "./routes/apps"
import { uploadsRoutes } from "./routes/uploads"
import { clientsRoutes } from "./routes/clients"
import { statsRoutes } from "./routes/stats"
import { utilsRoutes } from "./routes/utils"

// Create Hono app with typed environment bindings
const app = new Hono<{ Bindings: Env }>()

// ============================================================================
// GLOBAL MIDDLEWARE
// ============================================================================

// Security headers
app.use("*", secureHeaders())

// CORS - allow all origins for Expo clients
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      // Expo-specific headers
      "expo-project",
      "expo-platform",
      "expo-runtime-version",
      "expo-channel-name",
      "expo-protocol-version",
      "expo-expect-signature",
      "expo-embedded-update-id",
      "expo-current-update-id",
      "eas-client-id",
      // Upload headers
      "project",
      "version",
      "release-channel",
      "upload-key",
      "git-branch",
      "git-commit",
    ],
    exposeHeaders: [
      "expo-protocol-version",
      "expo-sfv-version",
      "expo-signature",
    ],
  }),
)

// Request logging (development)
app.use("*", logger())

// Pretty JSON responses for API routes
app.use("/api/*", prettyJSON())
app.use("/status", prettyJSON())
app.use("/authentication", prettyJSON())
app.use("/apps/*", prettyJSON())
app.use("/uploads/*", prettyJSON())
app.use("/upload", prettyJSON())
app.use("/clients/*", prettyJSON())
app.use("/stats/*", prettyJSON())
app.use("/utils/*", prettyJSON())

// ============================================================================
// PUBLIC ROUTES (No Authentication)
// ============================================================================

// Health check
app.get("/status", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "2.0.0-cf",
  })
})

// Expo Updates Protocol endpoints
app.route("/api", apiRoutes)

// ============================================================================
// AUTHENTICATED ROUTES
// ============================================================================

// Authentication (login/logout)
app.route("/authentication", authRoutes)

// Protected API routes (require JWT)
app.route("/apps", appsRoutes)
app.route("/uploads", uploadsRoutes)
app.route("/clients", clientsRoutes)
app.route("/stats", statsRoutes)
app.route("/utils", utilsRoutes)

// Upload endpoint (requires upload-key, not JWT)
app.route("/upload", uploadsRoutes)

// ============================================================================
// DYNAMIC ENV-CONFIG.JS FOR WEB DASHBOARD
// ============================================================================

app.get("/env-config.js", (c) => {
  const config = {
    API_BASE_URL: c.env.PUBLIC_URL || "",
    ENVIRONMENT: "production",
  }

  return new Response(`window._env_ = ${JSON.stringify(config, null, 2)};`, {
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  })
})

// ============================================================================
// STATIC ASSETS (Web Dashboard)
// ============================================================================

// Serve static assets for paths that don't match API routes
app.get("*", async (c) => {
  const url = new URL(c.req.url)
  const pathname = url.pathname

  // Skip API paths (already handled above)
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/status") ||
    pathname.startsWith("/authentication") ||
    pathname.startsWith("/apps") ||
    pathname.startsWith("/uploads") ||
    pathname.startsWith("/upload") ||
    pathname.startsWith("/clients") ||
    pathname.startsWith("/stats") ||
    pathname.startsWith("/utils")
  ) {
    return c.json({ error: "Not Found" }, 404)
  }

  // Check if ASSETS binding exists
  if (!c.env.ASSETS) {
    return c.json(
      { error: "Static assets not configured. Run: npm run build:web" },
      500,
    )
  }

  try {
    // Try to serve the requested file
    let response = await c.env.ASSETS.fetch(c.req.raw)

    // If not found or is HTML (SPA routing), serve index.html
    if (response.status === 404 || !pathname.includes(".")) {
      const indexRequest = new Request(
        new URL("/index.html", c.req.url).toString(),
        c.req.raw,
      )
      response = await c.env.ASSETS.fetch(indexRequest)
    }

    // Add cache headers for static assets
    if (response.ok && pathname.includes(".")) {
      const headers = new Headers(response.headers)
      // Cache assets with hashes for 1 year
      if (pathname.includes("/assets/")) {
        headers.set("Cache-Control", "public, max-age=31536000, immutable")
      } else {
        headers.set("Cache-Control", "no-cache")
      }
      return new Response(response.body, {
        status: response.status,
        headers,
      })
    }

    return response
  } catch {
    // Fallback: serve index.html for SPA routing
    try {
      const indexRequest = new Request(
        new URL("/index.html", c.req.url).toString(),
        c.req.raw,
      )
      return await c.env.ASSETS.fetch(indexRequest)
    } catch {
      return c.json({ error: "Static assets not found" }, 404)
    }
  }
})

// ============================================================================
// ERROR HANDLING
// ============================================================================

app.onError((err, c) => {
  console.error("Unhandled error:", err)

  if (err.message.includes("Unauthorized")) {
    return c.json({ error: "Unauthorized" }, 401)
  }

  if (err.message.includes("Not Found")) {
    return c.json({ error: "Not Found" }, 404)
  }

  return c.json(
    {
      error: "Internal Server Error",
      message: err.message,
    },
    500,
  )
})

// ============================================================================
// EXPORT
// ============================================================================

export default app
