/**
 * Apps Routes
 *
 * CRUD operations for managing Expo applications.
 * All routes require JWT authentication.
 */

import { Hono } from "hono"
import { jwt } from "hono/jwt"
import { drizzle } from "drizzle-orm/d1"
import { eq, sql } from "drizzle-orm"

import type { Env } from "../types"
import { apps, type NewApp } from "../db/schema"
import { resolveAppId } from "../services/helpers"

const appsRouter = new Hono<{ Bindings: Env }>()

// Apply JWT middleware to all routes
appsRouter.use("*", (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET })
  return jwtMiddleware(c, next)
})

/**
 * GET /apps
 * List all applications.
 */
appsRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB)
  const allApps = await db.select().from(apps)

  // Don't expose private keys in list
  return c.json(
    allApps.map((app) => ({
      ...app,
      privateKey: app.privateKey ? "[REDACTED]" : null,
    })),
  )
})

/**
 * GET /apps/:id
 * Get a single application by ID (slug). Case-insensitive lookup.
 */
appsRouter.get("/:id", async (c) => {
  const id = c.req.param("id")
  const db = drizzle(c.env.DB)

  // Case-insensitive lookup
  const [app] = await db
    .select()
    .from(apps)
    .where(sql`LOWER(${apps.id}) = LOWER(${id})`)
    .limit(1)

  if (!app) {
    return c.json({ error: "App not found" }, 404)
  }

  return c.json({
    ...app,
    privateKey: app.privateKey ? "[REDACTED]" : null,
    hasPrivateKey: !!app.privateKey,
  })
})

/**
 * POST /apps
 * Create a new application.
 */
appsRouter.post("/", async (c) => {
  const body = await c.req.json<NewApp>()
  const db = drizzle(c.env.DB)

  if (!body.id) {
    return c.json({ error: "App ID (slug) is required" }, 400)
  }

  // Check if app already exists (case-insensitive)
  const [existing] = await db
    .select()
    .from(apps)
    .where(sql`LOWER(${apps.id}) = LOWER(${body.id})`)
    .limit(1)

  if (existing) {
    return c.json({ error: "App already exists" }, 409)
  }

  const newApp: NewApp = {
    id: body.id,
    name: body.name || body.id,
    privateKey: body.privateKey,
    certificate: body.certificate,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  await db.insert(apps).values(newApp)

  return c.json(newApp, 201)
})

/**
 * PATCH /apps/:id
 * Update an application. Case-insensitive lookup.
 */
appsRouter.patch("/:id", async (c) => {
  const id = c.req.param("id")
  const body = await c.req.json<Partial<NewApp>>()
  const db = drizzle(c.env.DB)

  // Resolve actual app ID (case-insensitive)
  const actualId = await resolveAppId(db, id)
  if (!actualId) {
    return c.json({ error: "App not found" }, 404)
  }

  await db
    .update(apps)
    .set({
      ...body,
      updatedAt: new Date(),
    })
    .where(eq(apps.id, actualId))

  return c.json({ success: true })
})

/**
 * DELETE /apps/:id
 * Delete an application and all its uploads. Case-insensitive lookup.
 */
appsRouter.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const db = drizzle(c.env.DB)

  // Resolve actual app ID (case-insensitive)
  const actualId = await resolveAppId(db, id)
  if (!actualId) {
    return c.json({ error: "App not found" }, 404)
  }

  // TODO: Also delete uploads from R2

  await db.delete(apps).where(eq(apps.id, actualId))

  return c.json({ success: true })
})

export { appsRouter as appsRoutes }
