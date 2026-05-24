# Changelog

All notable changes to `stallari-mcp-helpers` (TypeScript) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-24

Initial release. Sister package to [stallari-mcp-helpers (Python)](https://pypi.org/project/stallari-mcp-helpers/) — same wire contract, same `_meta` envelope shape, idiomatic TypeScript API.

### Added
- `stallari-mcp-helpers` npm module — canonical `_meta: {...}` JSON-tail envelope builder for TypeScript MCP servers targeting Stallari's contract surface.
- `meta` module exports `MetaEnvelope` interface + `formatMetaLine(meta)` builder + `appendMeta(payload, metaLine)` joiner. Wire-shape locked per DD-338 Phase A.1 contract — sister to the Python canonical at parity.

### Motivation
- Per DD-338 Phase E.ts (architect amendment 2026-05-23, substrate-corrected 2026-05-24) — eliminates byte-for-byte duplication of `src/utils/meta.ts` across first-party Stallari TypeScript MCP servers (cloudflare-blade-mcp, vultr-blade-mcp). The pre-consolidation files explicitly acknowledged the duplication ("duplicated byte-for-byte across first-party TS blade-mcps... If this helper diverges across blades that is a contract bug") — this package retires that pattern by making consolidation the contract.

### Notes
- Public API frozen during `0.x` series only against breaking changes within a minor; subject to refinement until `1.0.0`.
- See [DD-338](https://github.com/Groupthink-dev) for the design record.
- `1.0.0` cut once consumer blade-mcps have shipped against `0.x` for >30 days with no API churn.
