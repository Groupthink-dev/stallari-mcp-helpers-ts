// E2E coverage for the published stallari-mcp-lint bin entrypoint.

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LINT_RULE_ID } from "../src/lint.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const distCli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

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

function writeOverDeclaredBlade(parent: string): { root: string; catalogPath: string } {
  const root = writeBlade(parent, "blade", {
    "server.ts": `
declare const server: { registerTool: (n: string, c: any, h: any) => void };

server.registerTool("t_silent", { title: "x" }, async (_args: any) => {
  return { content: [{ type: "text", text: "no envelope" }] };
});
`,
  });
  const catalogPath = join(parent, "catalog.json");
  writeFileSync(
    catalogPath,
    JSON.stringify(catalogFor("blade", [["t_silent", "structured"]])),
    "utf-8",
  );
  return { root, catalogPath };
}

let tmpRoot: string;

beforeAll(() => {
  if (!existsSync(distCli)) {
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url))],
      { cwd: repoRoot },
    );
  }
});

afterEach(() => {
  if (tmpRoot) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe("stallari-mcp-lint bin", () => {
  it("emits lint JSON when invoked through an npm-style symlink", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "stallari-lint-bin-test-"));
    const { root, catalogPath } = writeOverDeclaredBlade(tmpRoot);
    const symlinkPath = join(tmpRoot, "stallari-mcp-lint");
    symlinkSync(distCli, symlinkPath);

    const stdout = execFileSync(
      process.execPath,
      [symlinkPath, root, "--catalog", catalogPath],
      { encoding: "utf-8" },
    );

    expect((JSON.parse(stdout) as { lint_rule: string }).lint_rule).toBe(LINT_RULE_ID);
  });

  it("emits lint JSON when invoked by its direct path", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "stallari-lint-bin-test-"));
    const { root, catalogPath } = writeOverDeclaredBlade(tmpRoot);

    const stdout = execFileSync(
      process.execPath,
      [distCli, root, "--catalog", catalogPath],
      { encoding: "utf-8" },
    );

    expect((JSON.parse(stdout) as { lint_rule: string }).lint_rule).toBe(LINT_RULE_ID);
  });

  it("exits 1 for a strict over-declared verdict through an npm-style symlink", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "stallari-lint-bin-test-"));
    const { root, catalogPath } = writeOverDeclaredBlade(tmpRoot);
    const symlinkPath = join(tmpRoot, "stallari-mcp-lint");
    symlinkSync(distCli, symlinkPath);

    try {
      execFileSync(
        process.execPath,
        [symlinkPath, root, "--catalog", catalogPath, "--strict"],
        { encoding: "utf-8" },
      );
      throw new Error("expected --strict invocation to exit 1");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(1);
    }
  });
});
