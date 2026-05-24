// tests/lint.test.ts
//
// Tests for `lint` — mirrors `stallari_mcp_helpers/tests/test_lint.py`
// case-for-case (T1-T11 mapped to L1-L11 in the Python sister) and adds
// TS-specific decorator-shape coverage (registerTool object-config,
// `server.tool("name", schema, handler)` three-arg form, etc.).
//
// Synthesises tiny blade source trees under `os.tmpdir() + uuid` and
// runs `lintBlade` against synthetic catalog entries.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CANONICAL_EMIT_NAME,
  LINT_RULE_ID,
  lintBlade,
  type LintResult,
} from "../src/lint.js";
import { runCli } from "../src/cli.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SyntheticBlade {
  /** Root directory passed to lintBlade. */
  root: string;
  /** Catalog dict written under root/catalog.json. */
  catalogPath: string;
}

function writeBlade(
  parent: string,
  pkg: string,
  files: Record<string, string>,
): string {
  const pkgDir = join(parent, pkg);
  mkdirSync(pkgDir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const target = join(pkgDir, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body, "utf-8");
  }
  return parent;
}

function catalogFor(
  blade: string,
  tools: Array<[string, string]>,
): Record<string, unknown> {
  return {
    name: blade,
    tools: tools.map(([name, surface]) => ({
      name,
      granularity: { audit_surface: surface },
    })),
  };
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "stallari-lint-test-"));
});

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T1 — direct call pass
// ---------------------------------------------------------------------------

describe("S-AUD-001 — direct emission patterns", () => {
  it("T1: direct appendMeta call + structured catalog → match", async () => {
    const server = `
import { appendMeta, formatMetaLine } from "stallari-mcp-helpers";

declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_direct", { title: "x" }, async (_args: any) => {
  const meta = formatMetaLine({
    matched_total: 1, returned: 1, filtered_by: [],
    latency_ms: 1, redactions: [], next_cursor: null,
  });
  return { content: [{ type: "text", text: appendMeta("body", meta) }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeT1", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-t1", [["t_direct", "structured"]]));
    const v = result.tools["t_direct"]?.audit_surface;
    expect(v?.result).toBe("match");
    expect(v?.actual).toBe("structured");
  });

  it("T2: no appendMeta call + structured catalog → over-declared", async () => {
    const server = `
declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_silent", { title: "x" }, async (_args: any) => {
  return { content: [{ type: "text", text: "no envelope" }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeT2", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-t2", [["t_silent", "structured"]]));
    const v = result.tools["t_silent"]?.audit_surface;
    expect(v?.result).toBe("over-declared");
    expect(v?.actual).toBe("minimal");
  });
});

// ---------------------------------------------------------------------------
// T3 — indirect via re-export
// ---------------------------------------------------------------------------

describe("S-AUD-001 — indirect emission resolution", () => {
  it("T3: re-export from sibling module → match", async () => {
    const server = `
import { appendMeta, formatMetaLine } from "./formatters.js";

declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_reexport", { title: "x" }, async (_args: any) => {
  const meta = formatMetaLine({
    matched_total: 1, returned: 1, filtered_by: [],
    latency_ms: 1, redactions: [], next_cursor: null,
  });
  return { content: [{ type: "text", text: appendMeta("body", meta) }] };
});
`;
    const formatters = `
export { appendMeta, formatMetaLine } from "stallari-mcp-helpers";
`;
    const root = writeBlade(tmpRoot, "bladeT3", {
      "server.ts": server,
      "formatters.ts": formatters,
    });
    const result = await lintBlade(root, catalogFor("blade-t3", [["t_reexport", "structured"]]));
    const v = result.tools["t_reexport"]?.audit_surface;
    expect(v?.result).toBe("match");
  });

  it("T4: alias import (appendMeta as emit) → match", async () => {
    const server = `
import { appendMeta as emit, formatMetaLine } from "stallari-mcp-helpers";

declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_aliased", { title: "x" }, async (_args: any) => {
  const meta = formatMetaLine({
    matched_total: 0, returned: 0, filtered_by: [],
    latency_ms: 0, redactions: [], next_cursor: null,
  });
  return { content: [{ type: "text", text: emit("body", meta) }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeT4", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-t4", [["t_aliased", "structured"]]));
    const v = result.tools["t_aliased"]?.audit_surface;
    expect(v?.result).toBe("match");
  });

  it("T5: wrapper function in same module → match", async () => {
    const server = `
import { appendMeta, formatMetaLine } from "stallari-mcp-helpers";

declare const server: { registerTool: (n: string, c: any, h: any) => void };

function finalize(body: string, meta: any): string {
  return appendMeta(body, formatMetaLine(meta));
}

server.registerTool("t_wrapped", { title: "x" }, async (_args: any) => {
  return {
    content: [{
      type: "text",
      text: finalize("body", { matched_total: 1, returned: 1, filtered_by: [], latency_ms: 1, redactions: [], next_cursor: null }),
    }],
  };
});
`;
    const root = writeBlade(tmpRoot, "bladeT5", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-t5", [["t_wrapped", "structured"]]));
    const v = result.tools["t_wrapped"]?.audit_surface;
    expect(v?.result).toBe("match");
  });
});

// ---------------------------------------------------------------------------
// T6 / T7 — minimal catalog declarations
// ---------------------------------------------------------------------------

describe("S-AUD-001 — minimal declaration verdicts", () => {
  it("T6: catalog=minimal but tool calls appendMeta → under-declared", async () => {
    const server = `
import { appendMeta, formatMetaLine } from "stallari-mcp-helpers";

declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_undersold", { title: "x" }, async (_args: any) => {
  const meta = formatMetaLine({
    matched_total: 0, returned: 0, filtered_by: [],
    latency_ms: 0, redactions: [], next_cursor: null,
  });
  return { content: [{ type: "text", text: appendMeta("b", meta) }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeT6", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-t6", [["t_undersold", "minimal"]]));
    const v = result.tools["t_undersold"]?.audit_surface;
    expect(v?.result).toBe("under-declared");
  });

  it("T7: catalog=minimal and tool does not call appendMeta → match", async () => {
    const server = `
declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_honest_minimal", { title: "x" }, async (_args: any) => {
  return { content: [{ type: "text", text: "plain" }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeT7", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-t7", [["t_honest_minimal", "minimal"]]));
    const v = result.tools["t_honest_minimal"]?.audit_surface;
    expect(v?.result).toBe("match");
  });
});

// ---------------------------------------------------------------------------
// T8 — audit_surface=none (byte-blob tools)
// ---------------------------------------------------------------------------

describe("S-AUD-001 — audit_surface=none", () => {
  it("T8: declared=none → always match regardless of emission", async () => {
    const server = `
declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_bytes", { title: "x" }, async (_args: any) => {
  return { content: [{ type: "blob", text: "" }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeT8", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-t8", [["t_bytes", "none"]]));
    const v = result.tools["t_bytes"]?.audit_surface;
    expect(v?.result).toBe("match");
  });
});

// ---------------------------------------------------------------------------
// T9 — phantom tool (in catalog, missing from source)
// ---------------------------------------------------------------------------

describe("S-AUD-001 — indeterminate paths", () => {
  it("T9: catalog tool with no matching registerTool call → indeterminate", async () => {
    const server = `
declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("real_tool", { title: "x" }, async (_args: any) => {
  return { content: [{ type: "text", text: "" }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeT9", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-t9", [["phantom_tool", "structured"]]));
    const v = result.tools["phantom_tool"]?.audit_surface;
    expect(v?.result).toBe("indeterminate");
    expect(v?.actual).toBe("indeterminate");
    expect(v?.detail).toContain("no function definition");
  });

  it("unrecognised audit_surface value → indeterminate", async () => {
    const server = `
declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_junk", { title: "x" }, async (_args: any) => {
  return { content: [{ type: "text", text: "" }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeJunk", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-junk", [["t_junk", "totally-bogus"]]));
    const v = result.tools["t_junk"]?.audit_surface;
    expect(v?.result).toBe("indeterminate");
    expect(v?.detail).toContain("unrecognised audit_surface");
  });
});

// ---------------------------------------------------------------------------
// T10 — summary aggregation
// ---------------------------------------------------------------------------

describe("S-AUD-001 — aggregation", () => {
  it("T10: 5-tool mixed blade hits every counter slot", async () => {
    const server = `
import { appendMeta, formatMetaLine } from "stallari-mcp-helpers";

declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_match_struct", { title: "x" }, async (_args: any) => {
  const meta = formatMetaLine({
    matched_total: 0, returned: 0, filtered_by: [],
    latency_ms: 0, redactions: [], next_cursor: null,
  });
  return { content: [{ type: "text", text: appendMeta("b", meta) }] };
});

server.registerTool("t_over", { title: "x" }, async (_args: any) => {
  return { content: [{ type: "text", text: "no envelope" }] };
});

server.registerTool("t_under", { title: "x" }, async (_args: any) => {
  const meta = formatMetaLine({
    matched_total: 0, returned: 0, filtered_by: [],
    latency_ms: 0, redactions: [], next_cursor: null,
  });
  return { content: [{ type: "text", text: appendMeta("b", meta) }] };
});

server.registerTool("t_match_min", { title: "x" }, async (_args: any) => {
  return { content: [{ type: "text", text: "plain" }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeT10", { "server.ts": server });
    const catalog = catalogFor("blade-t10", [
      ["t_match_struct", "structured"],
      ["t_over", "structured"],
      ["t_under", "minimal"],
      ["t_match_min", "minimal"],
      ["phantom", "structured"],
    ]);
    const result = await lintBlade(root, catalog);
    expect(result.summary.tools_checked).toBe(5);
    expect(result.summary.match_count).toBe(2);
    expect(result.summary.over_declared_count).toBe(1);
    expect(result.summary.under_declared_count).toBe(1);
    expect(result.summary.indeterminate_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T11 — JSON shape contract
// ---------------------------------------------------------------------------

describe("S-AUD-001 — JSON shape contract", () => {
  it("T11: lint result serialises to documented schema (cross-lang parity)", async () => {
    const server = `
declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_only", { title: "x" }, async (_args: any) => {
  return { content: [{ type: "text", text: "plain" }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeT11", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-t11", [["t_only", "minimal"]]));
    const rendered = JSON.stringify(result);
    const reloaded = JSON.parse(rendered) as LintResult;
    expect(Object.keys(reloaded).sort()).toEqual(
      [
        "blade",
        "harness_version",
        "lint_rule",
        "summary",
        "tested_at",
        "tools",
      ].sort(),
    );
    expect(reloaded.lint_rule).toBe(LINT_RULE_ID);
    expect(reloaded.blade).toBe("blade-t11");
    const inner = reloaded.tools["t_only"]!;
    expect(Object.keys(inner)).toEqual(["audit_surface"]);
    expect(Object.keys(inner.audit_surface).sort()).toEqual(
      ["actual", "declared", "detail", "result"].sort(),
    );
    expect(Object.keys(reloaded.summary).sort()).toEqual(
      [
        "indeterminate_count",
        "match_count",
        "over_declared_count",
        "tools_checked",
        "under_declared_count",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// TS-specific decorator shape coverage
// ---------------------------------------------------------------------------

describe("S-AUD-001 — TS-specific registration shapes", () => {
  it("server.tool(name, schema, handler) three-arg form is recognised", async () => {
    const server = `
import { appendMeta, formatMetaLine } from "stallari-mcp-helpers";

declare const server: { tool: (n: string, s: any, h: any) => void };

server.tool("t_three_arg", { type: "object" }, async (_args: any) => {
  const meta = formatMetaLine({
    matched_total: 1, returned: 1, filtered_by: [],
    latency_ms: 1, redactions: [], next_cursor: null,
  });
  return { content: [{ type: "text", text: appendMeta("b", meta) }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeServerTool3", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-3", [["t_three_arg", "structured"]]));
    expect(result.tools["t_three_arg"]?.audit_surface.result).toBe("match");
  });

  it("server.tool(name, handler) two-arg form is recognised", async () => {
    const server = `
import { appendMeta, formatMetaLine } from "stallari-mcp-helpers";

declare const server: { tool: (n: string, h: any) => void };

server.tool("t_two_arg", async (_args: any) => {
  const meta = formatMetaLine({
    matched_total: 1, returned: 1, filtered_by: [],
    latency_ms: 1, redactions: [], next_cursor: null,
  });
  return { content: [{ type: "text", text: appendMeta("b", meta) }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeServerTool2", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-2", [["t_two_arg", "structured"]]));
    expect(result.tools["t_two_arg"]?.audit_surface.result).toBe("match");
  });

  it("object-config form { name, handler } is recognised", async () => {
    const server = `
import { appendMeta, formatMetaLine } from "stallari-mcp-helpers";

declare const server: { registerTool: (cfg: any) => void };

server.registerTool({
  name: "t_object_config",
  handler: async (_args: any) => {
    const meta = formatMetaLine({
      matched_total: 1, returned: 1, filtered_by: [],
      latency_ms: 1, redactions: [], next_cursor: null,
    });
    return { content: [{ type: "text", text: appendMeta("b", meta) }] };
  },
});
`;
    const root = writeBlade(tmpRoot, "bladeObjCfg", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-obj", [["t_object_config", "structured"]]));
    expect(result.tools["t_object_config"]?.audit_surface.result).toBe("match");
  });

  it("registration inside an exported function body is found", async () => {
    const server = `
import { appendMeta, formatMetaLine } from "stallari-mcp-helpers";

declare const server: { registerTool: (n: string, c: any, h: any) => void };

export function registerAllTools(s: typeof server): void {
  s.registerTool("t_nested", { title: "x" }, async (_args: any) => {
    const meta = formatMetaLine({
      matched_total: 1, returned: 1, filtered_by: [],
      latency_ms: 1, redactions: [], next_cursor: null,
    });
    return { content: [{ type: "text", text: appendMeta("b", meta) }] };
  });
}
`;
    const root = writeBlade(tmpRoot, "bladeNested", { "server.ts": server });
    const result = await lintBlade(root, catalogFor("blade-nested", [["t_nested", "structured"]]));
    expect(result.tools["t_nested"]?.audit_surface.result).toBe("match");
  });

  it("unparseable file is skipped, surrounding tools still resolve", async () => {
    const server = `
import { appendMeta, formatMetaLine } from "stallari-mcp-helpers";

declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_ok", { title: "x" }, async (_args: any) => {
  const meta = formatMetaLine({
    matched_total: 0, returned: 0, filtered_by: [],
    latency_ms: 0, redactions: [], next_cursor: null,
  });
  return { content: [{ type: "text", text: appendMeta("b", meta) }] };
});
`;
    // TS createSourceFile is tolerant; even very broken files only emit
    // diagnostics. We still write a totally-garbage file to verify the
    // walker doesn't crash.
    const root = writeBlade(tmpRoot, "bladeBroken", {
      "server.ts": server,
      "broken.ts": "@@@@ this is not valid ::: ts ::: at all\n",
    });
    const result = await lintBlade(root, catalogFor("blade-broken", [["t_ok", "structured"]]));
    expect(result.tools["t_ok"]?.audit_surface.result).toBe("match");
  });
});

// ---------------------------------------------------------------------------
// Module-surface constants
// ---------------------------------------------------------------------------

describe("S-AUD-001 — module surface", () => {
  it("public constants exported under expected names", () => {
    expect(CANONICAL_EMIT_NAME).toBe("appendMeta");
    expect(LINT_RULE_ID).toBe("S-AUD-001");
  });
});

// ---------------------------------------------------------------------------
// CLI smoke
// ---------------------------------------------------------------------------

describe("CLI — runCli", () => {
  it("--strict + over-declared verdict → returns 1 + writes sidecar", async () => {
    const server = `
declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_silent", { title: "x" }, async (_args: any) => {
  return { content: [{ type: "text", text: "no envelope" }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeCli", { "server.ts": server });
    const catalogPath = join(tmpRoot, "catalog.json");
    writeFileSync(
      catalogPath,
      JSON.stringify(catalogFor("blade-cli", [["t_silent", "structured"]])),
      "utf-8",
    );
    const outputPath = join(tmpRoot, "sidecar.json");
    const rc = await runCli([
      root,
      "--catalog",
      catalogPath,
      "--output",
      outputPath,
      "--strict",
    ]);
    expect(rc).toBe(1);
    const { readFileSync } = await import("node:fs");
    const payload = JSON.parse(readFileSync(outputPath, "utf-8")) as LintResult;
    expect(payload.lint_rule).toBe(LINT_RULE_ID);
    expect(payload.summary.over_declared_count).toBe(1);
  });

  it("without --strict, over-declared verdict → returns 0 + prints to stdout", async () => {
    const server = `
declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t", { title: "x" }, async (_args: any) => {
  return { content: [{ type: "text", text: "" }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeCliOk", { "server.ts": server });
    const catalogPath = join(tmpRoot, "catalog.json");
    writeFileSync(
      catalogPath,
      JSON.stringify(catalogFor("blade-cli-ok", [["t", "structured"]])),
      "utf-8",
    );
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg?: unknown) => {
      logs.push(String(msg));
    };
    let rc: number;
    try {
      rc = await runCli([root, "--catalog", catalogPath]);
    } finally {
      console.log = origLog;
    }
    expect(rc).toBe(0);
    expect(logs.join("\n")).toContain(LINT_RULE_ID);
  });

  it("missing catalog → returns 2", async () => {
    const rc = await runCli([
      tmpRoot,
      "--catalog",
      join(tmpRoot, "does-not-exist.json"),
    ]);
    expect(rc).toBe(2);
  });

  it("missing source root → returns 2", async () => {
    const rc = await runCli(["--catalog", "x"]);
    expect(rc).toBe(2);
  });

  it("missing --catalog → returns 2", async () => {
    const rc = await runCli([tmpRoot]);
    expect(rc).toBe(2);
  });
});

// Smoke: prove path separator behaviour cross-platform sanity check.
// (Not a verdict test — just a sanity assertion the walker found something.)
describe("internal — module walker", () => {
  it("walks nested directories and finds tool registrations", async () => {
    const server = `
import { appendMeta, formatMetaLine } from "stallari-mcp-helpers";

declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_top", { title: "x" }, async (_args: any) => {
  const meta = formatMetaLine({
    matched_total: 1, returned: 1, filtered_by: [],
    latency_ms: 1, redactions: [], next_cursor: null,
  });
  return { content: [{ type: "text", text: appendMeta("b", meta) }] };
});
`;
    const nested = `
import { appendMeta, formatMetaLine } from "stallari-mcp-helpers";

declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_nested_dir", { title: "x" }, async (_args: any) => {
  const meta = formatMetaLine({
    matched_total: 1, returned: 1, filtered_by: [],
    latency_ms: 1, redactions: [], next_cursor: null,
  });
  return { content: [{ type: "text", text: appendMeta("b", meta) }] };
});
`;
    const root = writeBlade(tmpRoot, "bladeWalk", {
      "server.ts": server,
      ["tools" + sep + "extra.ts"]: nested,
    });
    const result = await lintBlade(
      root,
      catalogFor("blade-walk", [
        ["t_top", "structured"],
        ["t_nested_dir", "structured"],
      ]),
    );
    expect(result.tools["t_top"]?.audit_surface.result).toBe("match");
    expect(result.tools["t_nested_dir"]?.audit_surface.result).toBe("match");
  });
});
