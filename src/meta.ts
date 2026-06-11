// src/meta.ts
//
// Canonical `_meta` audit envelope builder for Stallari-conformant
// TypeScript MCP servers — sister to the Python `stallari_mcp_helpers`
// `audit_envelope` module at full wire-shape parity.
//
// Wire shape locked per DD-338 Phase A.1 contract; envelope key emission
// order is fixed for cross-language byte parity with the Python canonical
// (12 keys, v0.4.0 contract):
//   matched_total, returned, filtered_by, latency_ms, redactions,
//   next_cursor, rows_affected, target_id, write_durability,
//   response_timestamp, error_notes, domain_hints
//
// DD-338 Phase D.1 (2026-05-24) extended this contract additively with the
// four optional write-tier fields (rows_affected, target_id,
// write_durability, response_timestamp) and relaxed `matched_total` /
// `returned` from required to optional (write-tier handlers omit them).
//
// DD-386 helper-lib hardening (2026-06-12, AUD-04-12) added `domain_hints`
// (12-key parity with the Python canonical v0.4.0) and locked the string
// collation: all sorted output (`filtered_by` entries, `domain_hints` keys)
// is ordered by raw Unicode CODE POINT, no normalisation — the semantics of
// Python's built-in `sorted()`. JavaScript's default `.sort()` is UTF-16
// code-unit order, which DISAGREES on astral-plane input; use
// `codePointCompare` (exported below), never the default comparator.
//
// Field-presence rules:
//   - `latency_ms` — REQUIRED, always present in output.
//   - `filtered_by`, `redactions` — always present (empty `[]` allowed);
//     `next_cursor` — always present (emit `null` when absent).
//   - `matched_total`, `returned` — OPTIONAL, omit-when-undefined. Read-
//     tier handlers should pass them; pure write-tier handlers omit.
//   - `rows_affected`, `target_id`, `write_durability`,
//     `response_timestamp`, `error_notes` — OPTIONAL, omit-when-undefined
//     (per Convention #22 / DEVFU
//     `2026-05-23-pack-spec-meta-omit-discipline-doc`).
//   - `error_notes` additionally omitted when empty array (legacy
//     discipline retained for backwards compatibility).
//   - `domain_hints` — OPTIONAL, omit when undefined OR empty object; keys
//     emitted sorted by Unicode code point.
//
// `filtered_by` is sorted by Unicode code point; `latency_ms` is rounded
// via `Math.round`. `JSON.stringify` default separators (no whitespace)
// match the Python canonical's `(",", ":")` separator pair.
//
// Backwards compatibility: existing read-tier call sites passing
// `matched_total: N, returned: M, ...` continue to work unchanged — those
// fields simply remain present in the emitted envelope. The change is
// purely additive (new optional fields) + relaxing (some required fields
// now optional).
//
// Pack-spec reference: docs/granularity.md § "audit_surface" — `structured`
// means the tool emits this `_meta` envelope alongside its data payload.
// The assembler (DD-287) lifts these fields into
// `ContextPacket.provenance.assemblySteps[].toolAudit` via the regex
// `\n\n_meta: (\{.*\})$` matching the line `appendMeta` emits.

export interface MetaEnvelope {
  // Read-tier (optional post-D.1; required pre-D.1 — see CHANGELOG 0.3.0)
  matched_total?: number;
  returned?: number;

  // Always-present discipline (empty / null defaults)
  filtered_by: string[];
  latency_ms: number;
  redactions: string[];
  next_cursor: string | null;

  // Write-tier (D.1, all optional — omit-when-undefined)
  rows_affected?: number;
  target_id?: string;
  /**
   * Canonical values: `"edge" | "central" | "replicated"`. Typed as plain
   * `string` at the lib layer — enum enforcement is the caller's
   * responsibility (lint-side hardening is out of scope for the helper).
   */
  write_durability?: string;
  /** ISO8601 string. */
  response_timestamp?: string;

  // Error / warning surface (optional, omit when undefined or empty)
  error_notes?: string[];

  /**
   * Domain-attribution hints (DD-386 / AUD-04-12 — 12-key parity with the
   * Python canonical v0.4.0). Omit when undefined OR empty object. Keys are
   * emitted sorted by Unicode code point (`codePointCompare`), matching
   * Python `sorted()` semantics for cross-language byte parity.
   */
  domain_hints?: Record<string, string>;
}

/**
 * Lexicographic comparison over Unicode CODE POINTS — the locked canonical
 * collation for all sorted `_meta` output (`filtered_by`, `domain_hints`
 * keys). Matches the semantics of Python's built-in `sorted()` over `str`.
 *
 * Why not JavaScript's default `.sort()`? The default comparator orders by
 * UTF-16 CODE UNIT, which disagrees with code-point order on astral-plane
 * input. Example: U+FFFD (REPLACEMENT CHARACTER) must sort BEFORE
 * U+1F600 (GRINNING FACE) under code-point order (0xFFFD < 0x1F600), but
 * the default sort compares U+1F600's lead surrogate 0xD83D first
 * (0xD83D < 0xFFFD) and puts the emoji first — wrong, and a silent
 * cross-language parity break against the Python/Swift sisters.
 *
 * No Unicode normalisation is applied — raw code points only.
 */
export function codePointCompare(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i)!;
    const cb = b.codePointAt(j)!;
    if (ca !== cb) {
      return ca < cb ? -1 : 1;
    }
    // Advance by 2 UTF-16 code units for astral code points.
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  // Common prefix exhausted — the shorter string sorts first.
  const remA = a.length - i;
  const remB = b.length - j;
  if (remA === remB) return 0;
  return remA < remB ? -1 : 1;
}

/**
 * Format a `_meta:` envelope line for appending to a tool payload.
 *
 * Single-line JSON; assembler regex `\n\n_meta: (\{.*\})$`. Sorts
 * `filtered_by` by Unicode code point (`codePointCompare` — Python
 * `sorted()` semantics, NOT JS default UTF-16 code-unit order) and rounds
 * `latency_ms` for hash reproducibility.
 *
 * Key insertion order (canonical, byte-parity invariant across Python +
 * TypeScript + Swift sister helpers — 12 keys, v0.4.0 contract):
 *   matched_total, returned, filtered_by, latency_ms, redactions,
 *   next_cursor, rows_affected, target_id, write_durability,
 *   response_timestamp, error_notes, domain_hints
 *
 * Omit-when-undefined applies to: matched_total, returned, rows_affected,
 * target_id, write_durability, response_timestamp, error_notes (and
 * additionally error_notes when empty `[]`), domain_hints (and additionally
 * domain_hints when empty `{}`; keys emitted code-point sorted).
 * `filtered_by`, `latency_ms`, `redactions`, `next_cursor` are always
 * emitted.
 *
 * Hand-assembled to guarantee key order under the strict separators
 * (`","` / `":"`) the Python canonical uses; Node's `JSON.stringify`
 * preserves insertion order for string keys but constructing the object
 * field-by-field below documents the canonical order at the source.
 */
export function formatMetaLine(meta: MetaEnvelope): string {
  // Build canonical-order object field-by-field. `JSON.stringify` then
  // serialises keys in insertion order. Omit-when-undefined gates on
  // each optional field; defined entries are added, undefined ones
  // skipped. The four always-present fields are added unconditionally.
  const out: Record<string, unknown> = {};

  if (meta.matched_total !== undefined) {
    out.matched_total = meta.matched_total;
  }
  if (meta.returned !== undefined) {
    out.returned = meta.returned;
  }
  out.filtered_by = [...meta.filtered_by].sort(codePointCompare);
  out.latency_ms = Math.round(meta.latency_ms);
  out.redactions = meta.redactions;
  out.next_cursor = meta.next_cursor;
  if (meta.rows_affected !== undefined) {
    out.rows_affected = meta.rows_affected;
  }
  if (meta.target_id !== undefined) {
    out.target_id = meta.target_id;
  }
  if (meta.write_durability !== undefined) {
    out.write_durability = meta.write_durability;
  }
  if (meta.response_timestamp !== undefined) {
    out.response_timestamp = meta.response_timestamp;
  }
  if (meta.error_notes && meta.error_notes.length > 0) {
    out.error_notes = meta.error_notes;
  }
  if (meta.domain_hints !== undefined) {
    const keys = Object.keys(meta.domain_hints);
    if (keys.length > 0) {
      // Build a fresh object inserting keys in code-point-sorted order so
      // JSON.stringify (insertion-order for string keys) preserves the
      // canonical collation on the wire.
      const hints: Record<string, string> = {};
      for (const key of keys.sort(codePointCompare)) {
        hints[key] = meta.domain_hints[key]!;
      }
      out.domain_hints = hints;
    }
  }

  return "_meta: " + JSON.stringify(out);
}

/**
 * Append a `_meta` envelope line to an existing text payload using the
 * canonical `\n\n` separator. Use this helper at every tool-handler site;
 * do NOT inline the concatenation.
 */
export function appendMeta(payload: string, metaLine: string): string {
  return `${payload}\n\n${metaLine}`;
}
