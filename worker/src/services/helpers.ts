/**
 * Helper utilities for database operations
 */

import { drizzle } from "drizzle-orm/d1"
import { sql } from "drizzle-orm"
import { apps } from "../db/schema"

type DrizzleDB = ReturnType<typeof drizzle>

/**
 * Resolve an app ID using case-insensitive lookup.
 * Returns the actual app ID with correct casing, or null if not found.
 *
 * This ensures foreign key constraints work correctly while allowing
 * users to use any casing in URLs.
 */
export async function resolveAppId(
  db: DrizzleDB,
  projectId: string,
): Promise<string | null> {
  const [app] = await db
    .select({ id: apps.id })
    .from(apps)
    .where(sql`LOWER(${apps.id}) = LOWER(${projectId})`)
    .limit(1)

  return app?.id ?? null
}

/**
 * Build a case-insensitive equality condition for project/app ID.
 * Use this in WHERE clauses when you need case-insensitive matching.
 */
export function eqIgnoreCase(column: typeof apps.id, value: string) {
  return sql`LOWER(${column}) = LOWER(${value})`
}
