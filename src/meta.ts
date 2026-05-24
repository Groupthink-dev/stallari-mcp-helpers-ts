// src/meta.ts
//
// Canonical `_meta` audit envelope builder for Stallari-conformant
// TypeScript MCP servers — sister to the Python `stallari_mcp_helpers`
// `audit_envelope` module at full wire-shape parity.
//
// Wire shape locked per DD-338 Phase A.1 contract; envelope key emission
// order is fixed for cross-language byte parity with the Python canonical:
//   matched_total, returned, filtered_by, latency_ms, redactions,
//   next_cursor, rows_affected, target_id, write_durability,
//   response_timestamp, error_notes
//
// DD-338 Phase D.1 (2026-05-24) extended this contract additively with the
// four optional write-tier fields (rows_affected, target_id,
// write_durability, response_timestamp) and relaxed `matched_total` /
// `returned` from required to optional (write-tier handlers omit them).
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
//
// `filtered_by` is alphabetically sorted; `latency_ms` is rounded via
// `Math.round`. `JSON.stringify` default separators (no whitespace) match
// the Python canonical's `(",", ":")` separator pair.
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
}

/**
 * Format a `_meta:` envelope line for appending to a tool payload.
 *
 * Single-line JSON; assembler regex `\n\n_meta: (\{.*\})$`. Sorts
 * `filtered_by` alphabetically and rounds `latency_ms` for hash
 * reproducibility.
 *
 * Key insertion order (canonical, byte-parity invariant across Python +
 * TypeScript + Swift sister helpers):
 *   matched_total, returned, filtered_by, latency_ms, redactions,
 *   next_cursor, rows_affected, target_id, write_durability,
 *   response_timestamp, error_notes
 *
 * Omit-when-undefined applies to: matched_total, returned, rows_affected,
 * target_id, write_durability, response_timestamp, error_notes (and
 * additionally error_notes when empty `[]`). `filtered_by`, `latency_ms`,
 * `redactions`, `next_cursor` are always emitted.
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
  out.filtered_by = [...meta.filtered_by].sort();
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
