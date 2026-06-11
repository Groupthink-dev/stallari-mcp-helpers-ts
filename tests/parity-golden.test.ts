// tests/parity-golden.test.ts
//
// Cross-language golden parity fixture — byte-locked v0.4.0 wire contract.
//
// IDENTICAL literals exist in the Python canonical (`stallari-mcp-helpers`)
// and Swift (`stallari-mcp-helpers-swift`) sister repos. If this test ever
// needs editing, the contract has moved and ALL THREE repos must move in
// lockstep — do not "fix" the expected string here in isolation.
//
// The fixture deliberately includes the collation-hostile pair:
//   U+FFFD (REPLACEMENT CHARACTER, BMP) vs U+1F600 (GRINNING FACE, astral).
// Under the locked code-point collation U+FFFD sorts BEFORE U+1F600; JS
// default `.sort()` (UTF-16 code-unit order) gets this backwards because
// U+1F600's lead surrogate is 0xD83D < 0xFFFD.
//
// Note the RENDERED string carries raw UTF-8 characters (JSON.stringify
// does not escape non-ASCII), matching Python's ensure_ascii=False posture
// in the canonical.

import { describe, expect, it } from "vitest";

import { codePointCompare, formatMetaLine } from "../src/meta.js";

describe("v0.4.0 cross-language golden parity", () => {
  it("full 12-key envelope renders the byte-locked golden line", () => {
    const line = formatMetaLine({
      matched_total: 42,
      returned: 10,
      // Deliberately jumbled input order — output must be code-point sorted.
      filtered_by: ["zeta", "Alpha", "émile", "\u{1F600}a", "�b", "a/b"],
      latency_ms: 7,
      redactions: ["token"],
      next_cursor: "abc/def",
      rows_affected: 3,
      target_id: "t-1",
      write_durability: "edge",
      response_timestamp: "2026-06-12T00:00:00+10:00",
      error_notes: ["note"],
      // Deliberate insertion order r2, r1, ré — output keys must be
      // code-point sorted (r1, r2, ré).
      domain_hints: { r2: "work", r1: "family", "ré": "home" },
    });
    expect(line).toBe(
      '_meta: {"matched_total":42,"returned":10,"filtered_by":["Alpha","a/b","zeta","émile","�b","\u{1F600}a"],"latency_ms":7,"redactions":["token"],"next_cursor":"abc/def","rows_affected":3,"target_id":"t-1","write_durability":"edge","response_timestamp":"2026-06-12T00:00:00+10:00","error_notes":["note"],"domain_hints":{"r1":"family","r2":"work","ré":"home"}}',
    );
  });

  it("minimal write-tier envelope renders the byte-locked golden line", () => {
    const line = formatMetaLine({
      latency_ms: 1,
      filtered_by: [],
      redactions: [],
      next_cursor: null,
      rows_affected: 1,
      target_id: "x",
      write_durability: "edge",
    });
    expect(line).toBe(
      '_meta: {"filtered_by":[],"latency_ms":1,"redactions":[],"next_cursor":null,"rows_affected":1,"target_id":"x","write_durability":"edge"}',
    );
  });

  it("domain_hints empty object is omitted (omit-when-empty discipline)", () => {
    const line = formatMetaLine({
      latency_ms: 1,
      filtered_by: [],
      redactions: [],
      next_cursor: null,
      domain_hints: {},
    });
    expect(line).not.toContain("domain_hints");
  });

  it("codePointCompare orders U+FFFD before U+1F600 (default sort gets it wrong)", () => {
    const hostile = ["\u{1F600}a", "�b"];
    // Locked collation: BMP U+FFFD (0xFFFD) < astral U+1F600 (0x1F600).
    expect([...hostile].sort(codePointCompare)).toEqual([
      "�b",
      "\u{1F600}a",
    ]);
    // Demonstrate the divergence: default sort compares the lead surrogate
    // 0xD83D first and puts the emoji before U+FFFD — the wrong order.
    expect([...hostile].sort()).toEqual(["\u{1F600}a", "�b"]);
  });

  it("codePointCompare: common-prefix exhaustion — shorter sorts first", () => {
    expect(codePointCompare("ab", "abc")).toBeLessThan(0);
    expect(codePointCompare("abc", "ab")).toBeGreaterThan(0);
    expect(codePointCompare("abc", "abc")).toBe(0);
  });
});
