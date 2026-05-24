// tests/meta.test.ts
//
// Comprehensive tests for the `meta` module — wire-shape canonicalisation
// per DD-338 Phase E.ts Spec A v2. Coverage target: 100% line + branch on
// src/meta.ts. Cases enumerated in the spec § "Test Coverage".

import { describe, expect, it } from "vitest";

import {
  appendMeta,
  formatMetaLine,
  type MetaEnvelope,
} from "../src/meta.js";

describe("formatMetaLine — required fields", () => {
  it("case 1: required-fields-only envelope emits all 6 required keys with empty defaults", () => {
    const line = formatMetaLine({
      matched_total: 10,
      returned: 10,
      latency_ms: 42,
      filtered_by: [],
      redactions: [],
      next_cursor: null,
    });
    expect(line).toBe(
      '_meta: {"matched_total":10,"returned":10,"filtered_by":[],"latency_ms":42,"redactions":[],"next_cursor":null}',
    );
    // Every required key is present in the output.
    expect(line).toContain('"matched_total":10');
    expect(line).toContain('"returned":10');
    expect(line).toContain('"filtered_by":[]');
    expect(line).toContain('"latency_ms":42');
    expect(line).toContain('"redactions":[]');
    expect(line).toContain('"next_cursor":null');
  });

  it("case 2: filtered_by is alphabetically sorted in output", () => {
    const line = formatMetaLine({
      matched_total: 5,
      returned: 5,
      filtered_by: ["scope=work", "limit=10", "active=true"],
      latency_ms: 10,
      redactions: [],
      next_cursor: null,
    });
    expect(line).toContain(
      '"filtered_by":["active=true","limit=10","scope=work"]',
    );
  });

  it("case 3: populated redactions list emits as-is (no sort, not omitted)", () => {
    const line = formatMetaLine({
      matched_total: 1,
      returned: 1,
      filtered_by: [],
      latency_ms: 5,
      redactions: ["pii_email"],
      next_cursor: null,
    });
    expect(line).toContain('"redactions":["pii_email"]');
  });
});

describe("formatMetaLine — error_notes (optional, omit-when-empty)", () => {
  it("case 4: error_notes undefined → key absent from output", () => {
    const line = formatMetaLine({
      matched_total: 1,
      returned: 1,
      filtered_by: [],
      latency_ms: 1,
      redactions: [],
      next_cursor: null,
      // error_notes intentionally omitted
    });
    expect(line).not.toContain("error_notes");
  });

  it("case 5: error_notes empty array → key absent from output (empty = undefined-equivalent)", () => {
    const line = formatMetaLine({
      matched_total: 1,
      returned: 1,
      filtered_by: [],
      latency_ms: 1,
      redactions: [],
      next_cursor: null,
      error_notes: [],
    });
    expect(line).not.toContain("error_notes");
  });

  it("case 6: error_notes populated → key emitted with provided values", () => {
    const line = formatMetaLine({
      matched_total: 1,
      returned: 1,
      filtered_by: [],
      latency_ms: 1,
      redactions: [],
      next_cursor: null,
      error_notes: ["warn1", "warn2"],
    });
    expect(line).toContain('"error_notes":["warn1","warn2"]');
  });
});

describe("formatMetaLine — next_cursor field-presence", () => {
  it("case 7: next_cursor is string → emitted as string literal", () => {
    const line = formatMetaLine({
      matched_total: 100,
      returned: 10,
      filtered_by: [],
      latency_ms: 50,
      redactions: [],
      next_cursor: "cursor_abc",
    });
    expect(line).toContain('"next_cursor":"cursor_abc"');
  });

  it("case 8: next_cursor is null → emitted as literal null (NOT omitted)", () => {
    const line = formatMetaLine({
      matched_total: 10,
      returned: 10,
      filtered_by: [],
      latency_ms: 50,
      redactions: [],
      next_cursor: null,
    });
    expect(line).toContain('"next_cursor":null');
    // Sanity: never collapses to "next_cursor":"null" string.
    expect(line).not.toContain('"next_cursor":"null"');
  });
});

describe("formatMetaLine — determinism + canonical form", () => {
  it("case 9: identical input twice → byte-identical output (no key-order instability)", () => {
    const input: MetaEnvelope = {
      matched_total: 7,
      returned: 3,
      filtered_by: ["b", "a"],
      latency_ms: 12,
      redactions: ["r"],
      next_cursor: "c",
      error_notes: ["n"],
    };
    const a = formatMetaLine(input);
    const b = formatMetaLine(input);
    expect(a).toBe(b);
  });

  it("case 10: latency_ms is rounded via Math.round (234.7 → 235)", () => {
    const line = formatMetaLine({
      matched_total: 1,
      returned: 1,
      filtered_by: [],
      latency_ms: 234.7,
      redactions: [],
      next_cursor: null,
    });
    expect(line).toContain('"latency_ms":235');
  });

  it("case 10b: latency_ms rounds-down for fractions < 0.5 (234.3 → 234)", () => {
    const line = formatMetaLine({
      matched_total: 1,
      returned: 1,
      filtered_by: [],
      latency_ms: 234.3,
      redactions: [],
      next_cursor: null,
    });
    expect(line).toContain('"latency_ms":234');
  });

  it("case 11: strict separators — no whitespace after comma or colon (matches Python ',', ':')", () => {
    const line = formatMetaLine({
      matched_total: 1,
      returned: 1,
      filtered_by: ["x"],
      latency_ms: 1,
      redactions: ["r"],
      next_cursor: "c",
      error_notes: ["n"],
    });
    // JSON body (strip "_meta: " prefix) must have no ", " or ": " sequences.
    const jsonBody = line.slice("_meta: ".length);
    expect(jsonBody).not.toContain(", ");
    expect(jsonBody).not.toContain(": ");
    // Positive: comma+quote and colon-no-space pairs are present.
    expect(jsonBody).toContain(',"');
    expect(jsonBody).toContain('":');
  });

  it("case 11b: key emission order matches Python canonical (cross-language byte parity)", () => {
    const line = formatMetaLine({
      matched_total: 1,
      returned: 1,
      filtered_by: ["x"],
      latency_ms: 1,
      redactions: ["r"],
      next_cursor: "c",
      error_notes: ["n"],
    });
    // Locked order: matched_total, returned, filtered_by, latency_ms,
    // redactions, next_cursor, error_notes.
    expect(line).toBe(
      '_meta: {"matched_total":1,"returned":1,"filtered_by":["x"],"latency_ms":1,"redactions":["r"],"next_cursor":"c","error_notes":["n"]}',
    );
  });
});

describe("appendMeta", () => {
  it("case 12: joins payload + meta line with exactly two newlines", () => {
    expect(appendMeta("body text", "_meta: {}")).toBe("body text\n\n_meta: {}");
  });

  it("case 13: empty body → leading two newlines, then meta line", () => {
    expect(appendMeta("", "_meta: {}")).toBe("\n\n_meta: {}");
  });

  it("preserves multiline body content unchanged", () => {
    const body = "line one\nline two\nline three";
    const meta = '_meta: {"matched_total":1}';
    expect(appendMeta(body, meta)).toBe(`${body}\n\n${meta}`);
  });
});

describe("formatMetaLine — write-tier optional fields (DD-338 Phase D.1)", () => {
  // Each of rows_affected / target_id / write_durability /
  // response_timestamp follows omit-when-undefined discipline. Verified
  // present + absent for each, plus a kitchen-sink and a write-tier-only
  // case (matched_total + returned absent — pure write handler).

  it("case D1: rows_affected present → emitted; absent → omitted", () => {
    const present = formatMetaLine({
      matched_total: 1,
      returned: 1,
      filtered_by: [],
      latency_ms: 1,
      redactions: [],
      next_cursor: null,
      rows_affected: 7,
    });
    expect(present).toContain('"rows_affected":7');

    const absent = formatMetaLine({
      matched_total: 1,
      returned: 1,
      filtered_by: [],
      latency_ms: 1,
      redactions: [],
      next_cursor: null,
    });
    expect(absent).not.toContain("rows_affected");
  });

  it("case D2: target_id present → emitted; absent → omitted", () => {
    const present = formatMetaLine({
      latency_ms: 1,
      filtered_by: [],
      redactions: [],
      next_cursor: null,
      target_id: "zone-123",
    });
    expect(present).toContain('"target_id":"zone-123"');

    const absent = formatMetaLine({
      latency_ms: 1,
      filtered_by: [],
      redactions: [],
      next_cursor: null,
    });
    expect(absent).not.toContain("target_id");
  });

  it("case D3: write_durability present → emitted as string; absent → omitted", () => {
    const present = formatMetaLine({
      latency_ms: 1,
      filtered_by: [],
      redactions: [],
      next_cursor: null,
      write_durability: "central",
    });
    expect(present).toContain('"write_durability":"central"');

    const absent = formatMetaLine({
      latency_ms: 1,
      filtered_by: [],
      redactions: [],
      next_cursor: null,
    });
    expect(absent).not.toContain("write_durability");
  });

  it("case D3b: write_durability accepts canonical values (edge / central / replicated) — typed as plain string, no enum enforcement at lib layer", () => {
    for (const value of ["edge", "central", "replicated"]) {
      const line = formatMetaLine({
        latency_ms: 1,
        filtered_by: [],
        redactions: [],
        next_cursor: null,
        write_durability: value,
      });
      expect(line).toContain(`"write_durability":"${value}"`);
    }
  });

  it("case D4: response_timestamp present → emitted; absent → omitted", () => {
    const present = formatMetaLine({
      latency_ms: 1,
      filtered_by: [],
      redactions: [],
      next_cursor: null,
      response_timestamp: "2026-05-24T12:34:56+10:00",
    });
    expect(present).toContain(
      '"response_timestamp":"2026-05-24T12:34:56+10:00"',
    );

    const absent = formatMetaLine({
      latency_ms: 1,
      filtered_by: [],
      redactions: [],
      next_cursor: null,
    });
    expect(absent).not.toContain("response_timestamp");
  });

  it("case D5 (kitchen sink): all read + write fields together emit in canonical key order", () => {
    const line = formatMetaLine({
      matched_total: 99,
      returned: 25,
      filtered_by: ["scope=work"],
      latency_ms: 123,
      redactions: ["pii_email"],
      next_cursor: "page_2",
      rows_affected: 3,
      target_id: "record-abc",
      write_durability: "replicated",
      response_timestamp: "2026-05-24T12:34:56+10:00",
      error_notes: ["truncated"],
    });
    expect(line).toBe(
      '_meta: {"matched_total":99,"returned":25,"filtered_by":["scope=work"],"latency_ms":123,"redactions":["pii_email"],"next_cursor":"page_2","rows_affected":3,"target_id":"record-abc","write_durability":"replicated","response_timestamp":"2026-05-24T12:34:56+10:00","error_notes":["truncated"]}',
    );
  });

  it("case D6 (write-tier only): matched_total + returned omitted; write-tier fields present", () => {
    const line = formatMetaLine({
      latency_ms: 15,
      filtered_by: [],
      redactions: [],
      next_cursor: null,
      rows_affected: 1,
      target_id: "zone-123",
      write_durability: "central",
    });
    // Read-tier fields absent — these are no longer required.
    expect(line).not.toContain("matched_total");
    expect(line).not.toContain('"returned":');
    // Write-tier fields present, in canonical order; always-present
    // fields emitted with their empty defaults.
    expect(line).toBe(
      '_meta: {"filtered_by":[],"latency_ms":15,"redactions":[],"next_cursor":null,"rows_affected":1,"target_id":"zone-123","write_durability":"central"}',
    );
  });

  it("case D7 (key order, all-fields): canonical key order locked across langs", () => {
    const line = formatMetaLine({
      matched_total: 1,
      returned: 1,
      filtered_by: ["x"],
      latency_ms: 1,
      redactions: ["r"],
      next_cursor: "c",
      rows_affected: 2,
      target_id: "t",
      write_durability: "edge",
      response_timestamp: "2026-01-01T00:00:00+00:00",
      error_notes: ["n"],
    });
    // Verify key order via substring index — each subsequent key must
    // appear after the previous one. This guards against silent key
    // reordering across helpers, langs, or future JS engine changes.
    const order = [
      "matched_total",
      "returned",
      "filtered_by",
      "latency_ms",
      "redactions",
      "next_cursor",
      "rows_affected",
      "target_id",
      "write_durability",
      "response_timestamp",
      "error_notes",
    ];
    let lastIdx = -1;
    for (const key of order) {
      const idx = line.indexOf(`"${key}":`);
      expect(idx, `key ${key} should appear in canonical order`).toBeGreaterThan(
        lastIdx,
      );
      lastIdx = idx;
    }
  });

  it("case D8 (backwards-compat read-tier shape unchanged): pre-D.1 callers produce identical wire output", () => {
    // The exact line that cloudflare-blade-mcp v0.6.0 + vultr-blade-mcp
    // pre-D.1 callers produce must continue to be emitted byte-for-byte.
    const line = formatMetaLine({
      matched_total: 10,
      returned: 5,
      filtered_by: [],
      latency_ms: 42,
      redactions: [],
      next_cursor: null,
    });
    expect(line).toBe(
      '_meta: {"matched_total":10,"returned":5,"filtered_by":[],"latency_ms":42,"redactions":[],"next_cursor":null}',
    );
  });
});

describe("formatMetaLine — assembler regex contract (case 14)", () => {
  // The assembler (DD-287) extracts `_meta` via the regex
  // `\n\n_meta: (\{.*\})$` matched at end-of-string. The line produced
  // by `formatMetaLine` alone (without preceding newlines) must match
  // the tail portion `_meta: (\{.*\})$`.
  const tail = /^_meta: (\{.*\})$/;

  it.each<[string, MetaEnvelope]>([
    [
      "required-only / empty defaults",
      {
        matched_total: 0,
        returned: 0,
        filtered_by: [],
        latency_ms: 0,
        redactions: [],
        next_cursor: null,
      },
    ],
    [
      "next_cursor string",
      {
        matched_total: 1,
        returned: 1,
        filtered_by: [],
        latency_ms: 1,
        redactions: [],
        next_cursor: "abc",
      },
    ],
    [
      "redactions populated",
      {
        matched_total: 1,
        returned: 1,
        filtered_by: [],
        latency_ms: 1,
        redactions: ["pii"],
        next_cursor: null,
      },
    ],
    [
      "error_notes populated",
      {
        matched_total: 1,
        returned: 1,
        filtered_by: [],
        latency_ms: 1,
        redactions: [],
        next_cursor: null,
        error_notes: ["warn"],
      },
    ],
    [
      "filtered_by populated (will be sorted)",
      {
        matched_total: 1,
        returned: 1,
        filtered_by: ["z", "a", "m"],
        latency_ms: 1,
        redactions: [],
        next_cursor: null,
      },
    ],
    [
      "all optional fields present",
      {
        matched_total: 99,
        returned: 25,
        filtered_by: ["scope=work"],
        latency_ms: 123,
        redactions: ["pii_email", "pii_phone"],
        next_cursor: "page_2",
        error_notes: ["truncated"],
      },
    ],
    [
      "write-tier-only envelope (D.1)",
      {
        latency_ms: 15,
        filtered_by: [],
        redactions: [],
        next_cursor: null,
        rows_affected: 1,
        target_id: "zone-123",
        write_durability: "central",
      },
    ],
    [
      "kitchen-sink read + write fields (D.1)",
      {
        matched_total: 99,
        returned: 25,
        filtered_by: ["scope=work"],
        latency_ms: 123,
        redactions: ["pii_email"],
        next_cursor: "page_2",
        rows_affected: 3,
        target_id: "record-abc",
        write_durability: "replicated",
        response_timestamp: "2026-05-24T12:34:56+10:00",
        error_notes: ["truncated"],
      },
    ],
  ])("matches assembler tail regex: %s", (_label, envelope) => {
    const line = formatMetaLine(envelope);
    const match = line.match(tail);
    expect(match).not.toBeNull();
    // The captured group must be valid JSON parseable back to an object.
    expect(() => JSON.parse(match![1]!)).not.toThrow();
  });
});
