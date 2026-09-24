import { describe, expect, it } from "vitest"

import { replacedPlatforms } from "./release"

describe("replacedPlatforms", () => {
  // Two platforms can share a runtime version (e.g. "1.3.3(45)"); releasing one
  // must not take the other's release down
  it("replaces only the same platform's release for a platform upload", () => {
    expect(replacedPlatforms("ios")).toEqual(["ios"])
    expect(replacedPlatforms("android")).toEqual(["android"])
  })

  // A platform release served alongside an "all" release wins by releasedAt, so
  // the "all" release keeps serving the other platform
  it("keeps an all-platform release serving the other platform", () => {
    expect(replacedPlatforms("ios")).not.toContain("all")
  })

  it("replaces every release when the upload covers both platforms", () => {
    expect(replacedPlatforms("all")).toEqual(["ios", "android", "all"])
  })
})
