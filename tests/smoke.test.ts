// Smoke test — verifies the package imports cleanly.
//
// Comprehensive tests for `meta` ship in `meta.test.ts` (Spec A v2 subagent).
// This file exists to keep CI green on the scaffold commit before those land,
// and as a permanent import-smoke guard going forward.

import { describe, expect, it } from "vitest";

describe("package smoke", () => {
  it("exports __version__ matching package.json", async () => {
    const mod = await import("../src/index.js");
    expect(mod.__version__).toBe("0.2.0");
  });
});
