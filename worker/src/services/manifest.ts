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
 * Parse Expo request headers and query parameters.
 * Headers take precedence over query parameters.
 */
export function parseExpoRequest(
  c: Context<{ Bindings: Env }>,
): ExpoRequestContext | { error: string } {
  const headers = c.req.header()
  const query = c.req.query()

  const project = headers["expo-project"] || query.project
  const platform = headers["expo-platform"] || query.platform
  const runtimeVersion = headers["expo-runtime-version"] || query.version
  const releaseChannel = headers["expo-channel-name"] || query.channel

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
 */
export function createMultipartResponse(
  manifest: ExpoManifest,
  extensions: ManifestExtensions,
  signature?: string,
  protocolVersion: string = "0",
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
  body += JSON.stringify(manifest)
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
// CRYPTOGRAPHIC OPERATIONS
// ============================================================================

/**
 * Sign manifest using RSA-SHA256.
 * Returns signature in Structured Headers format: sig="<base64>", keyid="main"
 */
export async function signManifest(
  manifestJson: string,
  privateKeyPem: string,
): Promise<string> {
  try {
    // Parse PEM to get raw key bytes
    const keyData = pemToArrayBuffer(privateKeyPem)

    // Import as CryptoKey
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      keyData,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      false,
      ["sign"],
    )

    // Sign the manifest
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(manifestJson),
    )

    // Encode as base64 and format as Structured Headers dictionary
    const base64Signature = arrayBufferToBase64(signature)
    return `sig="${base64Signature}", keyid="main"`
  } catch (error) {
    console.error("Failed to sign manifest:", error)
    throw new Error("Manifest signing failed")
  }
}

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
 * Convert PEM-encoded key to ArrayBuffer.
 */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  // Remove PEM headers and whitespace
  const base64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/, "")
    .replace(/-----END [A-Z ]+-----/, "")
    .replace(/\s/g, "")

  // Decode base64 to binary
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

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
