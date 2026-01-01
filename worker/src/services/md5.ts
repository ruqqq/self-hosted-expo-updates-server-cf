/**
 * MD5 Hash Module
 *
 * Re-exports md5 function from js-md5 library.
 * Web Crypto API doesn't support MD5 (it's considered insecure),
 * but Expo uses MD5 for asset keys.
 */

import { md5 as jsMd5 } from "js-md5"

/**
 * Compute MD5 hash of data as hex string.
 */
export function md5(data: ArrayBuffer | Uint8Array | string): string {
  if (typeof data === "string") {
    return jsMd5(data)
  }
  if (data instanceof ArrayBuffer) {
    return jsMd5(new Uint8Array(data))
  }
  return jsMd5(data)
}
