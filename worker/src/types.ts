/**
 * Cloudflare Worker Environment Bindings
 */

export interface Env {
  // D1 Database
  DB: D1Database

  // R2 Bucket for update files
  R2: R2Bucket

  // Static assets (Web Dashboard)
  ASSETS: Fetcher

  // Environment variables
  JWT_SECRET: string
  UPLOAD_KEY: string
  PUBLIC_URL: string
  ADMIN_PASSWORD: string
}

// Extend Hono context with our bindings
declare module "hono" {
  interface ContextVariableMap {
    user: {
      id: string
      username: string
      role: "admin" | "user"
    }
  }
}

// Request context after parsing Expo headers
export interface ExpoRequestContext {
  project: string
  platform: "ios" | "android"
  runtimeVersion: string
  releaseChannel: string
  protocolVersion: string
  expectSignature: boolean
  clientId?: string
  embeddedUpdateId?: string
  currentUpdateId?: string
}

// Manifest structure for Expo Updates protocol
export interface ExpoManifest {
  id: string
  createdAt: string
  runtimeVersion: string
  launchAsset: ExpoAsset
  assets: ExpoAsset[]
  metadata: Record<string, unknown>
  extra: {
    expoClient?: Record<string, unknown>
  }
}

export interface ExpoAsset {
  hash: string
  key: string
  fileExtension: string
  contentType: string
  url: string
}

// Extensions in the multipart response
export interface ManifestExtensions {
  assetRequestHeaders: Record<string, Record<string, string>>
}
