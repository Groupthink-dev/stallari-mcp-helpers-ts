// Canonical helpers for Stallari-conformant TypeScript MCP servers.
//
// Public API populated by Spec A v2 coding subagent — see
// ~/master-ai/atlas/utilities/agent-harness/specs/2026-05-24-dd-338-e-ts-mcp-helpers-package.md

export {
  appendMeta,
  codePointCompare,
  formatMetaLine,
  type MetaEnvelope,
} from "./meta.js";

export {
  TransportPolicyError,
  checkBearer,
  requireBearer,
  resolveHttpTransport,
  strictEnvBool,
  type HttpTransportConfig,
} from "./transport.js";

export {
  CANONICAL_EMIT_NAME,
  CANONICAL_LIB_PACKAGE,
  LINT_RULE_ID,
  lintBlade,
  type AuditSurfaceVerdict,
  type LintResult,
  type LintSummary,
  type ToolVerdict,
} from "./lint.js";

export const __version__ = "0.4.0";
