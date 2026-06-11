# stallari-mcp-helpers (TypeScript)

Canonical helpers for TypeScript MCP servers targeting **Stallari**'s contract surface — a tight library that lets your tools emit the `_meta` audit envelope the Stallari assembler expects, without you rolling your own.

If you're porting a TypeScript MCP server to Stallari and want first-party-tier conformance, this is the on-ramp.

## About Stallari

Stallari is an agentic personal-knowledge-management platform. It runs [MCP servers](https://modelcontextprotocol.io) as its tool surface — the way it talks to email providers, calendars, smart-home hubs, source control, cloud infra, etc. Your MCP server dispatches through Stallari's assembler, which audits each tool call against a wire-shape contract before lifting the result into the LLM's context. This package provides the canonical helpers that make a TypeScript MCP server emit that contract cleanly.

## Sister packages

| Language | Package | Source |
|---|---|---|
| **Python** | [`stallari-mcp-helpers` on PyPI](https://pypi.org/project/stallari-mcp-helpers/) | [`stallari-mcp-helpers`](https://github.com/Groupthink-dev/stallari-mcp-helpers) |
| **TypeScript** | [`stallari-mcp-helpers` on npm](https://www.npmjs.com/package/stallari-mcp-helpers) | this repo |
| **Swift** | `MCPHelpers` via Swift Package Manager | [`stallari-mcp-helpers-swift`](https://github.com/Groupthink-dev/stallari-mcp-helpers-swift) |

All three packages stay in lockstep on the wire shape — `meta_envelope(...)` in Python, `formatMetaLine(...)` in TypeScript, and `formatMetaLine(...)` in Swift all emit byte-equivalent `_meta` envelopes for the same input.

## What this is

Three small modules:

- **`meta`** — renders the canonical `_meta: {...}` JSON-tail block the Stallari assembler lifts into its `ContextPacket.provenance` audit trail. Locked encoding: tight JSON separators, code-point-sorted `filtered_by` and `domain_hints` keys (Python `sorted()` semantics via the exported `codePointCompare` — not JS default `.sort()`), required/optional field discipline matching the DD-338 wire contract (12-key v0.4.0 shape).
- **`lint`** — the S-AUD-001 static audit-surface honesty linter + `stallari-mcp-lint` CLI.
- **`transport`** — canonical HTTP transport policy (token-required bearer auth, loopback-default bind, wildcard-bind refusal). Framework-neutral, Node stdlib only. Use this instead of hand-rolling bearer/bind handling: token absent ⇒ refuse to serve (never warn-and-serve), `0.0.0.0`/`::` never, non-loopback only behind an explicit `{PREFIX}_MCP_ALLOW_NONLOOPBACK=true` opt-in, constant-time bearer comparison.

This package does **not** ship MCP-server scaffolding, tool registration, an HTTP server, inference, or domain-attribution primitives. It's deliberately small — the `transport` module is policy (config validation + an auth-gate wrapper), not a server.

For Python MCP authors, the sister package is [stallari-mcp-helpers on PyPI](https://pypi.org/project/stallari-mcp-helpers/) — same wire contract, same field-presence discipline.

## Audience

Direct consumers today:

- **First-party Stallari TS MCP servers** — `cloudflare-blade-mcp`, `vultr-blade-mcp`. (These previously each carried their own byte-identical copy of `src/utils/meta.ts`; this package eliminates the duplication.)

Broader audience:

- **Any TypeScript MCP author** who wants their server to dispatch through Stallari at first-party-tier conformance. You don't have to be on the Stallari team. Add the dep, use the helpers, declare your tool capabilities honestly in your pack manifest, and the assembler will treat your tool as a first-class participant.

If you're integrating a third-party MCP that you don't control, the Stallari adapter-transform layer (deterministic YAML, in-process) handles you separately — you don't need this library. See the Stallari docs for adapter-transform virtualisation if that's your path.

## Install

```bash
npm install stallari-mcp-helpers
# or
pnpm add stallari-mcp-helpers
# or
yarn add stallari-mcp-helpers
```

Requires Node.js >= 20.

## Quick start — emitting a `_meta` envelope

```typescript
import { formatMetaLine, appendMeta, type MetaEnvelope } from "stallari-mcp-helpers";

async function mySearchTool(query: string, scope: string = "personal"): Promise<string> {
  const records = await upstreamApi.search(query, { filter: `scope=${scope}` });
  const body = formatRecords(records);

  const meta: MetaEnvelope = {
    matched_total: records.totalMatched,
    returned: records.items.length,
    latency_ms: records.latencyMs,
    filtered_by: [`scope=${scope}`, `query=${query}`],
    redactions: [],          // required, empty allowed
    next_cursor: null,        // required, null allowed
  };
  return appendMeta(body, formatMetaLine(meta));
}
```

Output (assembler-side regex contract: `\n\n_meta: (\{.*\})$`):

```
<your body>

_meta: {"matched_total":42,"returned":10,"latency_ms":234,"filtered_by":["query=foo","scope=personal"],"redactions":[],"next_cursor":null}
```

## Your manifest

Per tool in your pack catalog entry:

```json
{
  "name": "my_search_tool",
  "granularity": {
    "scope_filtering": "server-side",
    "deterministic_ordering": "stable",
    "audit_surface": "structured",
    "domain_scope": "single"
  }
}
```

Four honest declarations. If you implement `scope_filtering: server-side` you must actually filter at the upstream API. If you declare `deterministic_ordering: stable` your output must be reproducible. If you declare `audit_surface: structured` your tool must emit `formatMetaLine(...)` on every call.

Stallari's conformance harness verifies these claims against your actual tool behaviour at pack-acceptance time. Honest degraded declarations always pass; lying about a capability fails. Start with the most conservative declarations and bump each axis as you implement the corresponding behaviour.

## What you don't have to think about

- Exact JSON encoding of `_meta` envelopes (separator choice, sort order)
- Field-presence rules (required vs optional)
- Whether to round `latency_ms`
- The assembler-side `ContextPacket` shape that consumes your envelopes
- Future contract evolution — the library version-pins the wire shape; the Python sister stays in lockstep

## API reference

```typescript
interface MetaEnvelope {
  matched_total?: number;     // optional (read-tier)
  returned?: number;          // optional (read-tier)
  filtered_by: string[];      // code-point sorted in output
  latency_ms: number;         // required, rounded
  redactions: string[];       // required, defaults to []
  next_cursor: string | null; // required, null is valid
  rows_affected?: number;     // optional (write-tier)
  target_id?: string;         // optional (write-tier)
  write_durability?: string;  // optional ("edge" | "central" | "replicated")
  response_timestamp?: string; // optional, ISO8601
  error_notes?: string[];     // optional, omitted when undefined/empty
  domain_hints?: Record<string, string>; // optional, omitted when undefined/empty;
                                         // keys emitted code-point sorted
}

function formatMetaLine(meta: MetaEnvelope): string;
function appendMeta(payload: string, metaLine: string): string;
function codePointCompare(a: string, b: string): number; // canonical collation

// transport — canonical HTTP transport policy (AUD-04-08 class closure)
class TransportPolicyError extends Error {}
function strictEnvBool(value: string | undefined): boolean; // exactly "true"
interface HttpTransportConfig { host: string; port: number; token: string }
function resolveHttpTransport(opts: {
  envPrefix: string;
  defaultPort: number;
  env?: Record<string, string | undefined>;
  tokenVar?: string;
}): HttpTransportConfig; // throws TransportPolicyError on policy violations
function checkBearer(authorizationHeader: string | undefined, expectedToken: string): boolean;
function requireBearer(expectedToken: string, handler: (req, res) => void): (req, res) => void;
```

## Versioning

SemVer. `0.x.y` series while the public API stabilises; `1.0.0` once consumer blade-mcps have shipped against `0.x` for >30 days with no API churn.

Breaking changes after `1.0.0` get a one-minor-version deprecation window (`v1.y` warns, `v2.0` removes).

## License

MIT. See `LICENSE`.

## Contributing

This is internal Stallari plumbing during the `0.x` series — issues + PRs accepted but the API surface is still settling. Submit issues at the [GitHub tracker](https://github.com/Groupthink-dev/stallari-mcp-helpers-ts/issues).
