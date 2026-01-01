/**
 * Drizzle ORM Schema for Cloudflare D1
 *
 * This schema mirrors the MongoDB collections from the original API:
 * - users: Admin and user accounts
 * - apps: Expo applications with code signing keys
 * - uploads: Update bundles and their metadata
 * - clients: Device tracking for analytics
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

// ============================================================================
// USERS TABLE
// ============================================================================
// Original: MongoDB 'users' collection
// Fields: _id, username, password (bcrypt), role
export const users = sqliteTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text("username").notNull().unique(),
  password: text("password").notNull(), // bcrypt hash (use bcryptjs in Workers)
  role: text("role", { enum: ["admin", "user"] })
    .default("user")
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
})

// ============================================================================
// APPS TABLE
// ============================================================================
// Original: MongoDB 'apps' collection with noBsonIDs: true (string IDs)
// Fields: _id (slug), privateKey (RSA for code signing)
export const apps = sqliteTable("apps", {
  // The app ID is the slug/project name (e.g., "my-expo-app")
  id: text("id").primaryKey(),
  name: text("name"),
  // RSA private key in PEM format for code signing
  // NULL if code signing is not enabled for this app
  privateKey: text("private_key"),
  // RSA certificate in PEM format (public key)
  certificate: text("certificate"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
})

// ============================================================================
// UPLOADS TABLE
// ============================================================================
// Original: MongoDB 'uploads' collection
// This is the core table for managing update bundles
export const uploads = sqliteTable(
  "uploads",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Foreign key to apps table
    project: text("project")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),

    // Version and channel for update routing
    version: text("version").notNull(), // Runtime version (e.g., "1.0.0")
    releaseChannel: text("release_channel").notNull(), // Channel name (e.g., "production", "staging")

    // Upload status workflow: ready → released → obsolete
    status: text("status", {
      enum: ["ready", "released", "obsolete"],
    })
      .default("ready")
      .notNull(),

    // R2 storage path for the update files
    // Format: updates/{project}/{version}/{id}/
    r2Path: text("r2_path").notNull(),

    // Cached metadata from the update bundle (stored as JSON strings)
    // This avoids fetching from R2 on every manifest request
    metadataJson: text("metadata_json"), // Contents of metadata.json
    appJson: text("app_json"), // expo field from app.json

    // Unique update identifier (UUID format, derived from metadata.json hash)
    updateId: text("update_id"),

    // Git information from publish script headers
    gitBranch: text("git_branch"),
    gitCommit: text("git_commit"),

    // Original upload information
    originalFilename: text("original_filename"),
    size: integer("size"), // bytes

    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
    releasedAt: integer("released_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
  },
  (table) => ({
    // Index for the most common query: find released update by project/version/channel
    projectVersionChannelIdx: index("uploads_project_version_channel_idx").on(
      table.project,
      table.version,
      table.releaseChannel,
      table.status,
    ),
    // Index for listing uploads by project
    projectCreatedIdx: index("uploads_project_created_idx").on(
      table.project,
      table.createdAt,
    ),
  }),
)

// ============================================================================
// CLIENTS TABLE
// ============================================================================
// Original: MongoDB 'clients' collection with noBsonIDs: true
// Tracks Expo client devices for analytics
export const clients = sqliteTable(
  "clients",
  {
    // The client ID is the EAS client ID from the expo-eas-client-id header
    id: text("id").primaryKey(),

    // Which app/version/channel this client is using
    project: text("project")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    version: text("version"),
    platform: text("platform", { enum: ["ios", "android"] }),
    releaseChannel: text("release_channel"),

    // Update tracking
    embeddedUpdate: text("embedded_update"), // Build's bundled update ID
    currentUpdate: text("current_update"), // Currently running update ID
    updateCount: integer("update_count").default(0), // Total update checks from this device

    // Activity tracking
    firstSeen: integer("first_seen", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
    lastSeen: integer("last_seen", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
  },
  (table) => ({
    // Index for stats queries by project
    projectPlatformIdx: index("clients_project_platform_idx").on(
      table.project,
      table.platform,
    ),
    // Index for finding active clients
    lastSeenIdx: index("clients_last_seen_idx").on(table.lastSeen),
  }),
)

// ============================================================================
// TYPE EXPORTS
// ============================================================================
// These types can be used throughout the application

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert

export type App = typeof apps.$inferSelect
export type NewApp = typeof apps.$inferInsert

export type Upload = typeof uploads.$inferSelect
export type NewUpload = typeof uploads.$inferInsert

export type Client = typeof clients.$inferSelect
export type NewClient = typeof clients.$inferInsert

// ============================================================================
// HELPER TYPES
// ============================================================================

export type UploadStatus = "ready" | "released" | "obsolete"
export type Platform = "ios" | "android"
export type UserRole = "admin" | "user"

// Asset entry in metadata.json
export interface ExpoAssetEntry {
  path: string
  ext: string
}

// Platform-specific file metadata
export interface ExpoPlatformMetadata {
  bundle: string
  assets: ExpoAssetEntry[]
}

// Metadata.json structure from Expo export
export interface ExpoMetadata {
  version: number
  fileMetadata: {
    ios: ExpoPlatformMetadata
    android: ExpoPlatformMetadata
  }
}

// App.json expo field structure (subset of full config)
export interface ExpoConfig {
  name?: string
  slug?: string
  version?: string
  sdkVersion?: string
  platforms?: string[]
  extra?: Record<string, unknown>
  [key: string]: unknown
}
