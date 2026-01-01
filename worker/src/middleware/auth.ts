/**
 * Authentication Middleware
 *
 * JWT verification middleware for protected routes.
 */

import { Context, Next } from 'hono'
import { jwt } from 'hono/jwt'
import type { Env } from '../types'

/**
 * JWT authentication middleware.
 * Verifies the Authorization header and sets user context.
 */
export function authMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET })
    return jwtMiddleware(c, next)
  }
}

/**
 * Upload key authentication middleware.
 * Used for the /upload endpoint (publish script).
 */
export async function uploadKeyMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const uploadKey = c.req.header('upload-key')

  if (!uploadKey || uploadKey !== c.env.UPLOAD_KEY) {
    return c.json({ error: 'Invalid upload key' }, 401)
  }

  await next()
}

/**
 * Admin-only middleware.
 * Must be used after authMiddleware.
 */
export async function adminOnly(c: Context<{ Bindings: Env }>, next: Next) {
  const payload = c.get('jwtPayload')

  if (!payload || payload.role !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403)
  }

  await next()
}
