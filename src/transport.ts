// src/transport.ts
//
// Canonical HTTP transport policy for Stallari-conformant TypeScript MCP
// servers — framework-neutral, Node stdlib only. Sister to the Python
// canonical `stallari_mcp_helpers.transport` (v0.4.0 locked contract).
//
// Closes the AUD-04-08 defect CLASS at the shared-lib layer: blades that
// hand-rolled their HTTP bearer/bind policy could serve UNAUTHENTICATED
// when the token env var was absent (token-absent ⇒ warn-and-serve). The
// canonical policy here is the opposite and non-negotiable:
//
//   - token absent / empty / whitespace ⇒ HTTP mode REFUSES TO SERVE
//     (throws TransportPolicyError) — never warn-and-serve;
//   - wildcard binds ("0.0.0.0", "::", "[::]", "") are refused
//     unconditionally — access-policy: never 0.0.0.0;
//   - non-loopback binds require {PREFIX}_MCP_ALLOW_NONLOOPBACK to be the
//     exact string "true" (strictEnvBool) — "1"/"True"/"yes" do not count;
//   - bearer comparison is constant-time (sha256-digest + timingSafeEqual,
//     length-safe);
//   - the token value never appears in any error message or response body.
//
// Per the blade transport policy (DD-242 / directives/blade-mcp-class.md):
// stdio is the default transport under the harness; HTTP is the manual /
// standalone path only, defaults to 127.0.0.1, and always requires a
// bearer token.

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Raised when the HTTP transport configuration violates the policy. */
export class TransportPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportPolicyError";
  }
}

/**
 * Strict environment-variable boolean: `true` ONLY for the exact string
 * `"true"`. `"1"`, `"True"`, `"TRUE"`, `"yes"`, etc. are all `false`.
 * Opt-ins to weakened transport posture must be unambiguous.
 */
export function strictEnvBool(value: string | undefined): boolean {
  return value === "true";
}

export interface HttpTransportConfig {
  host: string;
  port: number;
  token: string;
}

// Loopback = 127.0.0.0/8, ::1 (bracketed form included), or "localhost".
const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]", ""]);

function isLoopback(host: string): boolean {
  if (host === "localhost" || host === "::1" || host === "[::1]") return true;
  return LOOPBACK_V4.test(host);
}

/**
 * Resolve and validate the HTTP transport configuration from environment
 * variables. Throws `TransportPolicyError` on any policy violation; the
 * token value is never included in error messages.
 *
 * Env surface (PREFIX = `opts.envPrefix`):
 *   - `{PREFIX}_MCP_TOKEN` (or `opts.tokenVar` override) — REQUIRED;
 *     unset/empty/whitespace ⇒ refuse to serve.
 *   - `{PREFIX}_MCP_HOST` — default `"127.0.0.1"`; wildcard binds refused
 *     unconditionally; non-loopback requires the opt-in below.
 *   - `{PREFIX}_MCP_PORT` — default `opts.defaultPort`; strict integer in
 *     1..65535.
 *   - `{PREFIX}_MCP_ALLOW_NONLOOPBACK` — must be the exact string "true"
 *     to permit a non-loopback (non-wildcard) bind.
 */
export function resolveHttpTransport(opts: {
  envPrefix: string;
  defaultPort: number;
  env?: Record<string, string | undefined>;
  tokenVar?: string;
}): HttpTransportConfig {
  const env = opts.env ?? process.env;
  const prefix = opts.envPrefix;
  const tokenVar = opts.tokenVar ?? `${prefix}_MCP_TOKEN`;

  const token = env[tokenVar];
  if (token === undefined || token.trim() === "") {
    throw new TransportPolicyError(
      `${tokenVar} is unset or empty — HTTP mode refuses to serve without ` +
        "a bearer token. Set the token, or use stdio transport. " +
        "(Token-absent means refuse, never warn-and-serve — AUD-04-08.)",
    );
  }

  const host = env[`${prefix}_MCP_HOST`] ?? "127.0.0.1";
  if (WILDCARD_HOSTS.has(host)) {
    throw new TransportPolicyError(
      `refusing wildcard bind "${host}" — blade-mcp HTTP transport must ` +
        "never bind 0.0.0.0/::; bind a specific loopback or interface " +
        "address instead.",
    );
  }
  if (!isLoopback(host)) {
    const allowVar = `${prefix}_MCP_ALLOW_NONLOOPBACK`;
    if (!strictEnvBool(env[allowVar])) {
      throw new TransportPolicyError(
        `refusing non-loopback bind "${host}" — set ${allowVar}=true ` +
          '(the exact string "true") to opt in to a non-loopback bind.',
      );
    }
  }

  const portRaw = env[`${prefix}_MCP_PORT`];
  let port: number;
  if (portRaw === undefined || portRaw === "") {
    port = opts.defaultPort;
  } else if (/^\d+$/.test(portRaw)) {
    port = Number.parseInt(portRaw, 10);
  } else {
    throw new TransportPolicyError(
      `${prefix}_MCP_PORT="${portRaw}" is not an integer.`,
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TransportPolicyError(
      `port ${port} is outside the valid range 1..65535.`,
    );
  }

  return { host, port, token };
}

function sha256(data: string): Buffer {
  return createHash("sha256").update(data, "utf-8").digest();
}

/**
 * Validate an `Authorization` header against the expected bearer token.
 *
 * Parses `Bearer <credentials>` (scheme case-insensitive) and compares in
 * constant time: both sides are hashed with sha256 and the digests compared
 * via `crypto.timingSafeEqual` — constant-time and length-safe (no length
 * oracle from an early byte-length mismatch return).
 *
 * Throws `TransportPolicyError` when `expectedToken` is empty — an auth
 * gate configured with no token would silently recreate the AUD-04-08
 * defect.
 */
export function checkBearer(
  authorizationHeader: string | undefined,
  expectedToken: string,
): boolean {
  if (expectedToken === undefined || expectedToken.trim() === "") {
    throw new TransportPolicyError(
      "checkBearer called with an empty expected token — an auth gate " +
        "with no token silently recreates the unauthenticated-serve " +
        "defect (AUD-04-08).",
    );
  }
  if (authorizationHeader === undefined) return false;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (match === null) return false;
  const presented = match[1]!;
  return timingSafeEqual(sha256(presented), sha256(expectedToken));
}

/**
 * Wrap a Node `http` request handler with a bearer-token gate. Missing or
 * invalid credentials yield `401` with a `WWW-Authenticate: Bearer` header
 * and the body `"unauthorized"` — the token value is never echoed.
 *
 * Throws `TransportPolicyError` at wrap time when `expectedToken` is empty
 * (same rationale as `checkBearer`).
 */
export function requireBearer(
  expectedToken: string,
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): (req: IncomingMessage, res: ServerResponse) => void {
  if (expectedToken === undefined || expectedToken.trim() === "") {
    throw new TransportPolicyError(
      "requireBearer called with an empty expected token — an auth gate " +
        "with no token silently recreates the unauthenticated-serve " +
        "defect (AUD-04-08).",
    );
  }
  return (req: IncomingMessage, res: ServerResponse): void => {
    const ok = checkBearer(req.headers.authorization, expectedToken);
    if (!ok) {
      res.statusCode = 401;
      res.setHeader("WWW-Authenticate", "Bearer");
      res.end("unauthorized");
      return;
    }
    handler(req, res);
  };
}
