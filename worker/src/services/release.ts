/**
 * Release rules shared by release and rollback.
 */

import type { UploadPlatform } from "../db/schema"

/**
 * The platforms whose current release an upload replaces when it is released.
 *
 * iOS and Android builds can share a runtime version, so releasing one
 * platform's upload must leave the other platform's release alone. An upload
 * for both platforms replaces every release. A platform upload leaves an
 * "all" release in place: the manifest lookup takes the newest release for
 * the platform, so the new one wins there while "all" keeps serving the other.
 */
export function replacedPlatforms(platform: UploadPlatform): UploadPlatform[] {
  return platform === "all" ? ["ios", "android", "all"] : [platform]
}
