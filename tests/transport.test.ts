// tests/transport.test.ts
//
// Tests for the canonical HTTP transport policy (AUD-04-08 class closure).
// Mirrors the Python sister's refusal matrix: token-absent refuses,
// wildcard binds refused unconditionally, non-loopback requires the exact
// string "true", strict port parsing, constant-time bearer checks, and the
// 401 response shape with no token leakage.

import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import {
  TransportPolicyError,
  checkBearer,
  requireBearer,
  resolveHttpTransport,
  strictEnvBool,
} from "../src/transport.js";

const TOKEN = "sekrit-token-value";

function envWith(extra: Record<string, string | undefined> = {}) {
  return { BLADE_MCP_TOKEN: TOKEN, ...extra };
}

function resolve(env: Record<string, string | undefined>) {
  return resolveHttpTransport({ envPrefix: "BLADE", defaultPort: 9000, env });
}

// ---------------------------------------------------------------------------
// strictEnvBool
// ---------------------------------------------------------------------------

describe("strictEnvBool", () => {
  it('true ONLY for the exact string "true"', () => {
    expect(strictEnvBool("true")).toBe(true);
    for (const v of ["True", "TRUE", "1", "yes", "on", " true", "true ", "", undefined]) {
      expect(strictEnvBool(v), `value ${JSON.stringify(v)}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveHttpTransport — refusal matrix
// ---------------------------------------------------------------------------

describe("resolveHttpTransport — token policy", () => {
  it("token unset → refuses to serve", () => {
    expect(() => resolve({})).toThrow(TransportPolicyError);
    expect(() => resolve({})).toThrow(/refuses to serve/);
  });

  it("token empty → refuses", () => {
    expect(() => resolve({ BLADE_MCP_TOKEN: "" })).toThrow(TransportPolicyError);
  });

  it("token whitespace-only → refuses", () => {
    expect(() => resolve({ BLADE_MCP_TOKEN: "   " })).toThrow(TransportPolicyError);
  });

  it("refusal message never includes the token value", () => {
    try {
      resolve({ BLADE_MCP_TOKEN: "", BLADE_MCP_HOST: "0.0.0.0" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(String(err)).not.toContain(TOKEN);
    }
  });

  it("tokenVar override is honoured", () => {
    const cfg = resolveHttpTransport({
      envPrefix: "BLADE",
      defaultPort: 9000,
      env: { CUSTOM_TOKEN: "abc" },
      tokenVar: "CUSTOM_TOKEN",
    });
    expect(cfg.token).toBe("abc");
    // And the default var is NOT consulted when tokenVar overrides.
    expect(() =>
      resolveHttpTransport({
        envPrefix: "BLADE",
        defaultPort: 9000,
        env: { BLADE_MCP_TOKEN: "abc" },
        tokenVar: "CUSTOM_TOKEN",
      }),
    ).toThrow(TransportPolicyError);
  });
});

describe("resolveHttpTransport — bind policy", () => {
  it.each(["0.0.0.0", "::", "[::]", ""])(
    'wildcard bind "%s" refused even with token + non-loopback opt-in',
    (host) => {
      expect(() =>
        resolve(
          envWith({ BLADE_MCP_HOST: host, BLADE_MCP_ALLOW_NONLOOPBACK: "true" }),
        ),
      ).toThrow(TransportPolicyError);
    },
  );

  it.each(["127.0.0.1", "127.0.0.2", "::1", "localhost"])(
    'loopback variant "%s" passes without opt-in',
    (host) => {
      const cfg = resolve(envWith({ BLADE_MCP_HOST: host }));
      expect(cfg.host).toBe(host);
    },
  );

  it("host defaults to 127.0.0.1", () => {
    expect(resolve(envWith()).host).toBe("127.0.0.1");
  });

  it("non-loopback without opt-in → refused", () => {
    expect(() => resolve(envWith({ BLADE_MCP_HOST: "192.168.1.10" }))).toThrow(
      TransportPolicyError,
    );
  });

  it.each(["1", "True", "TRUE", "yes"])(
    'non-loopback with ALLOW_NONLOOPBACK="%s" (not exactly "true") → refused',
    (optin) => {
      expect(() =>
        resolve(
          envWith({
            BLADE_MCP_HOST: "192.168.1.10",
            BLADE_MCP_ALLOW_NONLOOPBACK: optin,
          }),
        ),
      ).toThrow(TransportPolicyError);
    },
  );

  it('non-loopback with ALLOW_NONLOOPBACK="true" → allowed', () => {
    const cfg = resolve(
      envWith({
        BLADE_MCP_HOST: "192.168.1.10",
        BLADE_MCP_ALLOW_NONLOOPBACK: "true",
      }),
    );
    expect(cfg.host).toBe("192.168.1.10");
  });
});

describe("resolveHttpTransport — port policy", () => {
  it("port defaults to defaultPort when unset", () => {
    expect(resolve(envWith()).port).toBe(9000);
  });

  it("valid integer port parses", () => {
    expect(resolve(envWith({ BLADE_MCP_PORT: "8443" })).port).toBe(8443);
  });

  it.each(["abc", "80.5", "0x50", "-1", "8000 "])(
    'non-strict-integer port "%s" → refused',
    (port) => {
      expect(() => resolve(envWith({ BLADE_MCP_PORT: port }))).toThrow(
        TransportPolicyError,
      );
    },
  );

  it.each(["0", "65536", "99999"])("out-of-range port %s → refused", (port) => {
    expect(() => resolve(envWith({ BLADE_MCP_PORT: port }))).toThrow(
      TransportPolicyError,
    );
  });

  it("boundary ports 1 and 65535 pass", () => {
    expect(resolve(envWith({ BLADE_MCP_PORT: "1" })).port).toBe(1);
    expect(resolve(envWith({ BLADE_MCP_PORT: "65535" })).port).toBe(65535);
  });
});

// ---------------------------------------------------------------------------
// checkBearer
// ---------------------------------------------------------------------------

describe("checkBearer", () => {
  it("valid bearer credential passes", () => {
    expect(checkBearer(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it('scheme is case-insensitive ("bearer", "BEARER")', () => {
    expect(checkBearer(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(checkBearer(`BEARER ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("wrong credential fails", () => {
    expect(checkBearer("Bearer wrong-token", TOKEN)).toBe(false);
  });

  it("missing header fails", () => {
    expect(checkBearer(undefined, TOKEN)).toBe(false);
  });

  it("Basic scheme fails", () => {
    expect(checkBearer(`Basic ${TOKEN}`, TOKEN)).toBe(false);
  });

  it("bare token (no scheme) fails", () => {
    expect(checkBearer(TOKEN, TOKEN)).toBe(false);
  });

  it("empty expected token → throws TransportPolicyError", () => {
    expect(() => checkBearer(`Bearer ${TOKEN}`, "")).toThrow(TransportPolicyError);
    expect(() => checkBearer(`Bearer ${TOKEN}`, "   ")).toThrow(
      TransportPolicyError,
    );
  });

  it("different-length wrong credential fails (no length shortcut)", () => {
    expect(checkBearer("Bearer x", TOKEN)).toBe(false);
    expect(checkBearer(`Bearer ${TOKEN}${TOKEN}`, TOKEN)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// requireBearer
// ---------------------------------------------------------------------------

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
}

function makeReqRes(authorization?: string): {
  req: IncomingMessage;
  res: ServerResponse;
  state: FakeRes;
} {
  const state: FakeRes = { statusCode: 200, headers: {}, body: "", ended: false };
  const req = { headers: { authorization } } as unknown as IncomingMessage;
  const res = {
    get statusCode() {
      return state.statusCode;
    },
    set statusCode(v: number) {
      state.statusCode = v;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
    },
    end(body?: string) {
      if (body !== undefined) state.body = body;
      state.ended = true;
    },
  } as unknown as ServerResponse;
  return { req, res, state };
}

describe("requireBearer", () => {
  it("valid credential delegates to the handler", () => {
    let called = false;
    const wrapped = requireBearer(TOKEN, () => {
      called = true;
    });
    const { req, res, state } = makeReqRes(`Bearer ${TOKEN}`);
    wrapped(req, res);
    expect(called).toBe(true);
    expect(state.ended).toBe(false);
  });

  it("missing credential → 401 with WWW-Authenticate: Bearer + 'unauthorized' body", () => {
    let called = false;
    const wrapped = requireBearer(TOKEN, () => {
      called = true;
    });
    const { req, res, state } = makeReqRes(undefined);
    wrapped(req, res);
    expect(called).toBe(false);
    expect(state.statusCode).toBe(401);
    expect(state.headers["WWW-Authenticate"]).toBe("Bearer");
    expect(state.body).toBe("unauthorized");
    expect(state.ended).toBe(true);
  });

  it("wrong credential → 401, never echoes the token", () => {
    const wrapped = requireBearer(TOKEN, () => {});
    const { req, res, state } = makeReqRes("Bearer nope");
    wrapped(req, res);
    expect(state.statusCode).toBe(401);
    expect(state.body).not.toContain(TOKEN);
    expect(JSON.stringify(state.headers)).not.toContain(TOKEN);
  });

  it("empty expected token → throws TransportPolicyError at wrap time", () => {
    expect(() => requireBearer("", () => {})).toThrow(TransportPolicyError);
  });
});
