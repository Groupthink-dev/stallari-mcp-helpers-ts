// src/meta.ts
//
// Canonical `_meta` audit envelope builder for Stallari-conformant
// TypeScript MCP servers — sister to the Python `stallari_mcp_helpers`
// `audit_envelope` module at full wire-shape parity.
//
// Wire shape locked per DD-338 Phase A.1 contract; envelope key emission
// order is fixed for cross-language byte parity with the Python canonical:
//   matched_total, returned, filtered_by, latency_ms, redactions,
//   next_cursor, [error_notes]
//
// Field-presence rules:
//   - `matched_total`, `returned`, `filtered_by`, `latency_ms`,
//     `redactions`, `next_cursor` — REQUIRED, always present in output.
//     `redactions` defaults to `[]`; `next_cursor` defaults to `null`.
//   - `error_notes` — OPTIONAL, omitted from output when undefined or
//     empty (per Convention #22 / DEVFU
//     `2026-05-23-pack-spec-meta-omit-discipline-doc`).
//
// `filtered_by` is alphabetically sorted; `latency_ms` is rounded via
// `Math.round`. `JSON.stringify` default separators (no whitespace) match
// the Python canonical's `(",", ":")` separator pair.
//
// Pack-spec reference: docs/granularity.md § "audit_surface" — `structured`
// means the tool emits this `_meta` envelope alongside its data payload.
// The assembler (DD-287) lifts these fields into
// `ContextPacket.provenance.assemblySteps[].toolAudit` via the regex
// `\n\n_meta: (\{.*\})$` matching the line `appendMeta` emits.

export interface MetaEnvelope {
  matched_total: number;
  returned: number;
  filtered_by: string[];
  latency_ms: number;
  redactions: string[];
  next_cursor: string | null;
  error_notes?: string[];
}

/**
 * Format a `_meta:` envelope line for appending to a tool payload.
 *
 * Single-line JSON; assembler regex `\n\n_meta: (\{.*\})$`. Sorts
 * `filtered_by` alphabetically and rounds `latency_ms` for hash
 * reproducibility. All required fields are always emitted; `error_notes`
 * is omitted when undefined or empty.
 *
 * Key insertion order matches the Python sister canonical:
 *   matched_total, returned, filtered_by, latency_ms, redactions,
 *   next_cursor, [error_notes]
 */
export function formatMetaLine(meta: MetaEnvelope): string {
  const sorted: MetaEnvelope = {
    matched_total: meta.matched_total,
    returned: meta.returned,
    filtered_by: [...meta.filtered_by].sort(),
    latency_ms: Math.round(meta.latency_ms),
    redactions: meta.redactions,
    next_cursor: meta.next_cursor,
  };
  if (meta.error_notes && meta.error_notes.length > 0) {
    sorted.error_notes = meta.error_notes;
  }
  return "_meta: " + JSON.stringify(sorted);
}

/**
 * Append a `_meta` envelope line to an existing text payload using the
 * canonical `\n\n` separator. Use this helper at every tool-handler site;
 * do NOT inline the concatenation.
 */
export function appendMeta(payload: string, metaLine: string): string {
  return `${payload}\n\n${metaLine}`;
}
