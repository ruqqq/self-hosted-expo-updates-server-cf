/**
 * Manifest Service
 *
 * Handles Expo manifest generation, signing, and multipart response creation.
 * Uses Web Crypto API for all cryptographic operations (Workers-compatible).
 */

import type { Context } from "hono"
import type {
  Env,
  ExpoRequestContext,
  ExpoManifest,
  ManifestExtensions,
} from "../types"

// For MD5 hashing (Web Crypto doesn't support MD5)
import { md5 } from "./md5"

// ============================================================================
// REQUEST PARSING
// ============================================================================

/**
 * Parse Expo request headers, query parameters, and path parameters.
 * Priority: headers > query params > path params
 */
export function parseExpoRequest(
  c: Context<{ Bindings: Env }>,
  pathProject?: string,
  pathChannel?: string,
): ExpoRequestContext | { error: string } {
  const headers = c.req.header()
  const query = c.req.query()

  const project = headers["expo-project"] || query.project || pathProject
  const platform = headers["expo-platform"] || query.platform
  const runtimeVersion = headers["expo-runtime-version"] || query.version
  const releaseChannel = headers["expo-channel-name"] || query.channel || pathChannel

  // Validate required fields
  if (!project) {
    return { error: "Missing project identifier" }
  }
  if (!platform || !["ios", "android"].includes(platform)) {
    return { error: "Invalid or missing platform (must be ios or android)" }
  }
  if (!runtimeVersion) {
    return { error: "Missing runtime version" }
  }
  if (!releaseChannel) {
    return { error: "Missing release channel" }
  }

  return {
    project,
    platform: platform as "ios" | "android",
    runtimeVersion,
    releaseChannel,
    protocolVersion: headers["expo-protocol-version"] || "0",
    expectSignature: headers["expo-expect-signature"] === "true",
    clientId: headers["eas-client-id"],
    embeddedUpdateId: headers["expo-embedded-update-id"],
    currentUpdateId: headers["expo-current-update-id"],
  }
}

// ============================================================================
// MULTIPART RESPONSE
// ============================================================================

/**
 * Create a multipart/mixed response for Expo manifest.
 * Format follows the Expo Updates protocol specification.
 *
 * @param manifest - The manifest object (will be stringified) OR a pre-stringified manifest
 * @param extensions - The extensions object
 * @param signature - Optional signature for code signing
 * @param protocolVersion - Protocol version (default "0")
 * @param manifestString - Optional pre-stringified manifest (used for signed manifests to preserve exact JSON)
 */
export function createMultipartResponse(
  manifest: ExpoManifest | null,
  extensions: ManifestExtensions,
  signature?: string,
  protocolVersion: string = "0",
  manifestString?: string,
): Response {
  const boundary = `----ExpoManifestBoundary${crypto.randomUUID().replace(/-/g, "")}`

  let body = ""

  // Part 1: Manifest
  body += `--${boundary}\r\n`
  body += "Content-Type: application/json; charset=utf-8\r\n"
  body += 'Content-Disposition: form-data; name="manifest"\r\n'
  if (signature) {
    body += `expo-signature: ${signature}\r\n`
  }
  body += "\r\n"
  // Use pre-stringified manifest if provided (preserves exact JSON for signature verification)
  body += manifestString ?? JSON.stringify(manifest)
  body += "\r\n"

  // Part 2: Extensions
  body += `--${boundary}\r\n`
  body += "Content-Type: application/json\r\n"
  body += 'Content-Disposition: form-data; name="extensions"\r\n'
  body += "\r\n"
  body += JSON.stringify(extensions)
  body += "\r\n"

  // Closing boundary
  body += `--${boundary}--\r\n`

  const headers: Record<string, string> = {
    "Content-Type": `multipart/mixed; boundary=${boundary}`,
    "expo-protocol-version": protocolVersion,
    "expo-sfv-version": "0",
    "Cache-Control": "private, max-age=0",
  }

  if (signature) {
    headers["expo-signature"] = signature
  }

  return new Response(body, { headers })
}

// ============================================================================
// CRYPTOGRAPHIC OPERATIONS (for asset hashing during upload)
// ============================================================================

/**
 * Compute SHA256 hash of asset data, encoded as Base64URL.
 * This matches Expo's asset hash format.
 */
export async function hashAsset(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const base64 = arrayBufferToBase64(hashBuffer)

  // Convert to Base64URL (RFC 4648 section 5)
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/**
 * Compute MD5 hash of asset data as hex string.
 * This is used as the asset "key" in Expo manifests.
 */
export function md5Hash(data: ArrayBuffer): string {
  return md5(data)
}

/**
 * Generate a UUID from a hash string (first 32 hex chars).
 * Format: 8-4-4-4-12
 */
export function hashToUuid(hash: string): string {
  const hex = hash
    .replace(/[^a-f0-9]/gi, "")
    .substring(0, 32)
    .padEnd(32, "0")
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32),
  ].join("-")
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert ArrayBuffer to base64 string.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
