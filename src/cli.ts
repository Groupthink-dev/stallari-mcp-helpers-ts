#!/usr/bin/env node
// src/cli.ts
//
// Console-script entrypoint for the S-AUD-001 lint registered as
// `stallari-mcp-lint` in package.json. Sister to the Python
// `stallari_mcp_helpers.lint._cli`.
//
// Usage:
//   stallari-mcp-lint <blade-source-root> --catalog <catalog.json>
//                     [--output <sidecar.json>] [--strict]
//
// `--strict` exits non-zero (1) on any over-declared / under-declared
// verdict. Indeterminate verdicts do not trip strict mode — they are
// "lint can't tell" rather than "lint says wrong".

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { LINT_RULE_ID, lintBlade, type LintResult } from "./lint.js";

interface ParsedArgs {
  sourceRoot: string | null;
  catalog: string | null;
  output: string | null;
  strict: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    sourceRoot: null,
    catalog: null,
    output: null,
    strict: false,
    help: false,
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      i++;
    } else if (arg === "--catalog") {
      out.catalog = argv[i + 1] ?? null;
      i += 2;
    } else if (arg === "--output") {
      out.output = argv[i + 1] ?? null;
      i += 2;
    } else if (arg === "--strict") {
      out.strict = true;
      i++;
    } else if (arg.startsWith("--")) {
      // Unknown flag — skip with value to be lenient.
      i += 2;
    } else if (out.sourceRoot === null) {
      out.sourceRoot = arg;
      i++;
    } else {
      i++;
    }
  }
  return out;
}

function printHelp(): void {
  const lines = [
    "stallari-mcp-lint — static audit-surface honesty linter (S-AUD-001)",
    "",
    "Usage:",
    "  stallari-mcp-lint <blade-source-root> --catalog <catalog.json>",
    "                    [--output <sidecar.json>] [--strict]",
    "",
    "Options:",
    "  --catalog PATH    Path to the blade's catalog JSON entry (required).",
    "  --output PATH     Optional sidecar JSON destination. Without --output,",
    "                    the verdict is printed to stdout.",
    "  --strict          Exit non-zero on any over-declared / under-declared",
    "                    verdict. Indeterminate verdicts do not trip strict.",
    "  -h, --help        Print this help and exit.",
    "",
    `Rule ID: ${LINT_RULE_ID}`,
  ];
  // eslint-disable-next-line no-console
  console.error(lines.join("\n"));
}

export async function runCli(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (args.sourceRoot === null) {
    // eslint-disable-next-line no-console
    console.error("error: missing required <blade-source-root> positional argument");
    printHelp();
    return 2;
  }
  if (args.catalog === null) {
    // eslint-disable-next-line no-console
    console.error("error: --catalog is required");
    printHelp();
    return 2;
  }

  const catalogPath = resolve(args.catalog);
  let catalogEntry: Record<string, unknown>;
  try {
    const text = readFileSync(catalogPath, "utf-8");
    catalogEntry = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`error: failed to load catalog ${catalogPath}: ${msg}`);
    return 2;
  }

  let result: LintResult;
  try {
    result = await lintBlade(args.sourceRoot, catalogEntry);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`error: lint failed: ${msg}`);
    return 2;
  }

  const payload = JSON.stringify(result, null, 2);
  if (args.output !== null) {
    writeFileSync(args.output, payload + "\n", "utf-8");
  } else {
    // eslint-disable-next-line no-console
    console.log(payload);
  }

  if (args.strict) {
    const s = result.summary;
    if (s.over_declared_count > 0 || s.under_declared_count > 0) {
      return 1;
    }
  }
  return 0;
}

// ESM-friendly main-module check.
// We compare realpaths so npm .bin symlinks resolve to this module.
const isMain = (() => {
  try {
    const argvPath = process.argv[1];
    if (!argvPath) return false;
    return realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  runCli(process.argv.slice(2)).then(
    (rc) => process.exit(rc),
    (err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(2);
    },
  );
}
