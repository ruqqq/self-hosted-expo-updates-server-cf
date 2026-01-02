/**
 * Authentication Routes
 *
 * Handles user login and JWT token generation.
 * Replaces FeathersJS authentication service.
 */

import { Hono } from "hono"
import { sign } from "hono/jwt"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import bcrypt from "bcryptjs"

import type { Env } from "../types"
import { users } from "../db/schema"

const auth = new Hono<{ Bindings: Env }>()

/**
 * POST /authentication
 * Login with username and password, returns JWT token.
 *
 * On first run (no users exist), creates admin user with ADMIN_PASSWORD.
 */
auth.post("/", async (c) => {
  const { username, password } = await c.req.json<{
    username: string
    password: string
  }>()

  if (!username || !password) {
    return c.json({ error: "Username and password are required" }, 400)
  }

  const db = drizzle(c.env.DB)

  // Check if any users exist - if not, create admin user
  const allUsers = await db.select().from(users).limit(1)
  if (allUsers.length === 0 && c.env.ADMIN_PASSWORD) {
    const hashedPassword = await bcrypt.hash(c.env.ADMIN_PASSWORD, 10)
    await db.insert(users).values({
      id: crypto.randomUUID(),
      username: "admin",
      password: hashedPassword,
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  // Find user by username
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1)

  if (!user) {
    return c.json({ error: "Invalid credentials" }, 401)
  }

  // Verify password
  const isValid = await bcrypt.compare(password, user.password)
  if (!isValid) {
    return c.json({ error: "Invalid credentials" }, 401)
  }

  // Generate JWT token
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
  }

  const token = await sign(payload, c.env.JWT_SECRET)

  return c.json({
    accessToken: token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  })
})

export { auth as authRoutes }
