/**
 * Clients Routes
 *
 * CRUD operations for client device tracking.
 * Used for analytics and monitoring which devices are using updates.
 */

import { Hono } from 'hono'
import { jwt } from 'hono/jwt'
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, desc } from 'drizzle-orm'

import type { Env } from '../types'
import { clients } from '../db/schema'

const clientsRouter = new Hono<{ Bindings: Env }>()

// Apply JWT middleware to all routes
clientsRouter.use('*', (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET })
  return jwtMiddleware(c, next)
})

/**
 * GET /clients
 * List clients, optionally filtered by project.
 */
clientsRouter.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const project = c.req.query('project')

  let query = db.select().from(clients)

  if (project) {
    query = query.where(eq(clients.project, project)) as typeof query
  }

  const results = await query.orderBy(desc(clients.lastSeen))
  return c.json(results)
})

/**
 * GET /clients/:id
 * Get single client by ID.
 */
clientsRouter.get('/:id', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  const [client] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1)

  if (!client) {
    return c.json({ error: 'Client not found' }, 404)
  }

  return c.json(client)
})

export { clientsRouter as clientsRoutes }
