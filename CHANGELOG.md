# Changelog

All notable changes to `stallari-mcp-helpers` (TypeScript) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-05-24

DD-338 Phase B — adds the S-AUD-001 static lint substrate. Sister to the Python lint at byte-identical JSON shape.

### Added
- `lint` module — AST-based audit-surface honesty linter for Stallari-conformant TS blade-mcps. Public entry `lintBlade(sourceRoot, catalogEntry)` walks the blade's TypeScript source tree, identifies tool registrations (`server.registerTool(...)`, `server.tool(...)`, object-config shape), and verifies whether each tool handler transitively calls `appendMeta` from `stallari-mcp-helpers`. Resolution graph follows direct imports, alias imports, re-exports, local consts, and wrapper functions up to 3 hops deep.
- `stallari-mcp-lint` console-script — invoked as `stallari-mcp-lint <blade-source-root> --catalog <catalog.json> [--output <sidecar.json>] [--strict]`. `--strict` exits non-zero on any over-declared / under-declared verdict (indeterminate does NOT trip strict).
- Public surface adds `lintBlade`, `LintResult`, `ToolVerdict`, `AuditSurfaceVerdict`, `LintSummary`, `CANONICAL_EMIT_NAME`, `CANONICAL_LIB_PACKAGE`, `LINT_RULE_ID`.
- `typescript` promoted from devDependency to runtime dependency (the lint depends on the TS compiler API for AST parsing).

### Notes
- Output JSON shape is byte-identical (modulo whitespace) to the Python sister so the unified `stallari-conformance verify --static` CLI can dispatch by runtime and aggregate verdicts uniformly.
- Verdicts: `match`, `over-declared`, `under-declared`, `indeterminate`. `indeterminate` is explicit "lint can't tell" — strict mode never trips on it.

## [0.1.0] - 2026-05-24

Initial release. Sister package to [stallari-mcp-helpers (Python)](https://pypi.org/project/stallari-mcp-helpers/) — same wire contract, same `_meta` envelope shape, idiomatic TypeScript API.

### Added
- `stallari-mcp-helpers` npm module — canonical `_meta: {...}` JSON-tail envelope builder for TypeScript MCP servers targeting Stallari's contract surface.
- `meta` module exports `MetaEnvelope` interface + `formatMetaLine(meta)` builder + `appendMeta(payload, metaLine)` joiner. Wire-shape locked per DD-338 Phase A.1 contract — sister to the Python canonical at parity.

#### `meta` module

- `interface MetaEnvelope { matched_total: number; returned: number; filtered_by: string[]; latency_ms: number; redactions: string[]; next_cursor: string | null; error_notes?: string[]; }` — typed envelope shape. `redactions` and `next_cursor` are required (always present in output, defaulting to `[]` and `null` respectively); `error_notes` is optional (omitted when undefined or empty per Convention #22).
- `formatMetaLine(meta: MetaEnvelope): string` — renders the canonical `_meta: {...}` JSON-tail line. Alphabetically sorts `filtered_by`, rounds `latency_ms` via `Math.round`, preserves key insertion order (`matched_total, returned, filtered_by, latency_ms, redactions, next_cursor, error_notes`) matching the Python sister canonical for cross-language byte parity.
- `appendMeta(payload: string, metaLine: string): string` — joins a body and a `_meta:` line with `\n\n` so the assembler regex `\n\n_meta: (\{.*\})$` matches at end-of-string.

### Motivation
- Per DD-338 Phase E.ts (architect amendment 2026-05-23, substrate-corrected 2026-05-24) — eliminates byte-for-byte duplication of `src/utils/meta.ts` across first-party Stallari TypeScript MCP servers (cloudflare-blade-mcp, vultr-blade-mcp). The pre-consolidation files explicitly acknowledged the duplication ("duplicated byte-for-byte across first-party TS blade-mcps... If this helper diverges across blades that is a contract bug") — this package retires that pattern by making consolidation the contract.

### Notes
- Public API frozen during `0.x` series only against breaking changes within a minor; subject to refinement until `1.0.0`.
- The wire contract is specified by Stallari internal design record DD-338 (private; the public summary surfaces gradually as the contract stabilises).
- `1.0.0` cut once consumer blade-mcps have shipped against `0.x` for >30 days with no API churn.
