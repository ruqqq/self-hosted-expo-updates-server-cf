/**
 * Stats Routes
 *
 * Aggregated statistics for the dashboard.
 */

import { Hono } from 'hono'
import { jwt } from 'hono/jwt'
import { drizzle } from 'drizzle-orm/d1'
import { eq, sql, count } from 'drizzle-orm'

import type { Env } from '../types'
import { clients, uploads } from '../db/schema'

const statsRouter = new Hono<{ Bindings: Env }>()

// Apply JWT middleware to all routes
statsRouter.use('*', (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET })
  return jwtMiddleware(c, next)
})

/**
 * GET /stats/:project
 * Get statistics for a specific project.
 */
statsRouter.get('/:project', async (c) => {
  const project = c.req.param('project')
  const db = drizzle(c.env.DB)

  // Get client counts by platform
  const platformStats = await db
    .select({
      platform: clients.platform,
      count: count(),
    })
    .from(clients)
    .where(eq(clients.project, project))
    .groupBy(clients.platform)

  // Get client counts by version
  const versionStats = await db
    .select({
      version: clients.version,
      count: count(),
    })
    .from(clients)
    .where(eq(clients.project, project))
    .groupBy(clients.version)

  // Get upload counts by status
  const uploadStats = await db
    .select({
      status: uploads.status,
      count: count(),
    })
    .from(uploads)
    .where(eq(uploads.project, project))
    .groupBy(uploads.status)

  // Get total clients
  const [totalClients] = await db
    .select({ count: count() })
    .from(clients)
    .where(eq(clients.project, project))

  // Get active clients (seen in last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [activeClients] = await db
    .select({ count: count() })
    .from(clients)
    .where(sql`${clients.project} = ${project} AND ${clients.lastSeen} > ${oneDayAgo.getTime()}`)

  return c.json({
    project,
    clients: {
      total: totalClients?.count || 0,
      active24h: activeClients?.count || 0,
      byPlatform: platformStats.reduce((acc, { platform, count }) => {
        acc[platform || 'unknown'] = count
        return acc
      }, {} as Record<string, number>),
      byVersion: versionStats.reduce((acc, { version, count }) => {
        acc[version || 'unknown'] = count
        return acc
      }, {} as Record<string, number>),
    },
    uploads: uploadStats.reduce((acc, { status, count }) => {
      acc[status || 'unknown'] = count
      return acc
    }, {} as Record<string, number>),
  })
})

export { statsRouter as statsRoutes }
