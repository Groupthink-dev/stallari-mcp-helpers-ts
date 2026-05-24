// src/lint.ts
//
// Static AST-based audit-surface honesty linter (S-AUD-001).
//
// DD-338 Phase B TypeScript implementation of the cross-language lint
// rule: "every blade-mcp tool whose catalog declares
// `granularity.audit_surface == 'structured'` must have its response
// builder invoke the canonical `appendMeta` helper from
// `stallari-mcp-helpers`."
//
// Sister to the Python canonical at
// `stallari_mcp_helpers.lint.lint_blade`. Output JSON shape is
// byte-identical to the Python sister so the unified
// `stallari-conformance verify --static` CLI can dispatch by runtime
// and aggregate verdicts uniformly.
//
// This module walks the blade-mcp's TypeScript source tree, identifies
// MCP tool registrations by their handler-registration shape
// (`server.registerTool("name", config, handler)` /
// `server.tool("name", schema, handler)` / `server.tool("name", handler)`),
// and verifies whether each tool handler transitively emits the
// `_meta` envelope by calling `appendMeta`.
//
// Resolution graph: direct imports, `import as` aliases, re-exports
// from sibling modules, local aliasing via `const X = appendMeta`,
// and wrapper functions whose body calls `appendMeta` are all traced
// up to `MAX_RESOLUTION_DEPTH` hops.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import * as ts from "typescript";

// The canonical emit name we trace through the resolution graph. A tool
// handler "emits" if its body calls any name that resolves transitively
// (up to MAX_RESOLUTION_DEPTH wrapper hops) to this identifier from the
// stallari-mcp-helpers package.
export const CANONICAL_EMIT_NAME = "appendMeta";
export const CANONICAL_LIB_PACKAGE = "stallari-mcp-helpers";

// Maximum wrapper-function hops the resolver will follow when
// determining whether an in-blade name is an alias of `appendMeta`.
// Three hops handles the common patterns:
//   1. direct import + call
//   2. re-export from a sibling module
//   3. wrapper function whose body calls `appendMeta`
// Deeper indirection is reported as `indeterminate`.
const MAX_RESOLUTION_DEPTH = 3;

// The lint rule identifier surfaced in the sidecar JSON.
export const LINT_RULE_ID = "S-AUD-001";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AuditSurfaceVerdict {
  declared: string;
  actual: "structured" | "minimal" | "indeterminate";
  result: "match" | "over-declared" | "under-declared" | "indeterminate";
  detail: string;
}

export interface ToolVerdict {
  audit_surface: AuditSurfaceVerdict;
}

export interface LintSummary {
  tools_checked: number;
  match_count: number;
  over_declared_count: number;
  under_declared_count: number;
  indeterminate_count: number;
}

export interface LintResult {
  blade: string;
  tested_at: string;
  harness_version: string;
  lint_rule: typeof LINT_RULE_ID;
  tools: Record<string, ToolVerdict>;
  summary: LintSummary;
}

// ---------------------------------------------------------------------------
// Internal module-info state
// ---------------------------------------------------------------------------

interface ToolFn {
  name: string;
  // The function/arrow-function node whose body is the handler.
  body: ts.Node;
}

interface ModuleInfo {
  path: string;
  sourceFile: ts.SourceFile;
  // Names bound in this module that resolve to canonical appendMeta.
  // Populated lazily by the propagation pass.
  canonicalNames: Set<string>;
  // Tool registrations found in this module, by tool name.
  tools: Map<string, ToolFn>;
  // Imports as { localName: { originModule, originalName } }.
  // originModule is the bare specifier text as written.
  imports: Map<string, { originModule: string; originalName: string }>;
  // `export { X } from "..."` / `export { X as Y } from "..."` —
  // visible to other modules. Stored as { exportedName: originalName }.
  // The from-module is the same as `imports` entries for the same name.
  reExports: Map<
    string,
    { originModule: string; originalName: string }
  >;
  // const X = Y / let X = Y simple aliases at module scope.
  aliases: Map<string, string>;
  // Module-level function declarations + arrow consts whose bodies we
  // inspect for wrapper-pattern detection. Keyed by exported name.
  functions: Map<string, ts.Node>;
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function lintBlade(
  bladeSourceRoot: string,
  catalogEntry: Record<string, unknown>,
): Promise<LintResult> {
  const root = resolve(bladeSourceRoot);
  const modules = buildResolver(root);

  // Global tool-name → (module, fn) index.
  const toolLocations = new Map<
    string,
    { module: ModuleInfo; fn: ToolFn }
  >();
  for (const module of modules.values()) {
    for (const [toolName, fn] of module.tools) {
      toolLocations.set(toolName, { module, fn });
    }
  }

  const tools: Record<string, ToolVerdict> = {};
  const counts = {
    match_count: 0,
    over_declared_count: 0,
    under_declared_count: 0,
    indeterminate_count: 0,
  };

  const catalogTools =
    (catalogEntry["tools"] as Array<Record<string, unknown>> | undefined) ?? [];
  for (const toolEntry of catalogTools) {
    const toolName = toolEntry["name"];
    if (typeof toolName !== "string") continue;
    const granularity =
      (toolEntry["granularity"] as Record<string, unknown> | undefined) ?? {};
    const declared =
      (granularity["audit_surface"] as string | undefined) ?? "minimal";

    const loc = toolLocations.get(toolName);
    const verdict =
      loc === undefined
        ? buildVerdict(toolName, declared, null, null)
        : buildVerdict(toolName, declared, loc.fn, loc.module);

    tools[toolName] = { audit_surface: verdict };
    if (verdict.result === "match") counts.match_count++;
    else if (verdict.result === "over-declared") counts.over_declared_count++;
    else if (verdict.result === "under-declared")
      counts.under_declared_count++;
    else counts.indeterminate_count++;
  }

  const summary: LintSummary = {
    tools_checked: Object.keys(tools).length,
    ...counts,
  };

  const { __version__ } = await import("./index.js");

  const blade =
    typeof catalogEntry["name"] === "string"
      ? (catalogEntry["name"] as string)
      : root.split(sep).pop() ?? root;

  return {
    blade,
    tested_at: isoSecondsUTC(new Date()),
    harness_version: __version__,
    lint_rule: LINT_RULE_ID,
    tools,
    summary,
  };
}

function isoSecondsUTC(d: Date): string {
  // Trim millis to seconds and force UTC, matching Python's
  // datetime.now(UTC).isoformat(timespec="seconds") (e.g. 2026-05-24T12:34:56+00:00).
  const iso = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
    ),
  ).toISOString();
  // toISOString → "2026-05-24T12:34:56.000Z". Convert to "+00:00".
  return iso.replace(/\.\d{3}Z$/, "+00:00");
}

// ---------------------------------------------------------------------------
// Source-tree resolver
// ---------------------------------------------------------------------------

function buildResolver(root: string): Map<string, ModuleInfo> {
  const modules = new Map<string, ModuleInfo>();
  const tsFiles = collectTsFiles(root);
  for (const filePath of tsFiles) {
    let sourceText: string;
    try {
      sourceText = readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    let sourceFile: ts.SourceFile;
    try {
      sourceFile = ts.createSourceFile(
        filePath,
        sourceText,
        ts.ScriptTarget.ES2022,
        /*setParentNodes*/ true,
        ts.ScriptKind.TS,
      );
    } catch {
      continue;
    }
    const moduleKey = pathToModuleKey(filePath, root);
    const info: ModuleInfo = {
      path: filePath,
      sourceFile,
      canonicalNames: new Set(),
      tools: new Map(),
      imports: new Map(),
      reExports: new Map(),
      aliases: new Map(),
      functions: new Map(),
    };
    collectModuleFacts(info);
    modules.set(moduleKey, info);
  }
  propagateCanonicalNames(modules, root);
  return modules;
}

function collectTsFiles(root: string): string[] {
  const out: string[] = [];
  walk(root, out);
  return out.sort();
}

function walk(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") {
      continue;
    }
    const full = join(dir, entry);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (st.isFile()) {
      if (
        entry.endsWith(".ts") &&
        !entry.endsWith(".d.ts") &&
        !entry.endsWith(".test.ts")
      ) {
        acc.push(full);
      }
    }
  }
}

function pathToModuleKey(filePath: string, root: string): string {
  // Use a POSIX-style relative path (without extension) as the key.
  // This is consumed only for cross-module re-export lookups; we match
  // both fully-qualified and suffix-relative forms.
  const rel = relative(root, filePath).replace(/\\/g, "/");
  return rel.replace(/\.tsx?$/, "");
}

// ---------------------------------------------------------------------------
// Module-fact collection
// ---------------------------------------------------------------------------

function collectModuleFacts(info: ModuleInfo): void {
  const { sourceFile } = info;

  for (const statement of sourceFile.statements) {
    collectImports(statement, info);
    collectAliases(statement, info);
    collectFunctions(statement, info);
  }

  // Tool registrations are call expressions, which may appear anywhere
  // (inside an exported function body like `registerWorkersTools`). Walk
  // the whole tree for these.
  function visit(node: ts.Node): void {
    const tool = extractToolRegistration(node);
    if (tool) {
      info.tools.set(tool.name, tool);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

function collectImports(node: ts.Node, info: ModuleInfo): void {
  if (ts.isImportDeclaration(node)) {
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const origin = node.moduleSpecifier.text;
    const clause = node.importClause;
    if (!clause) return;

    // `import { a, b as c } from "..."`
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const originalName = element.propertyName
          ? element.propertyName.text
          : element.name.text;
        const localName = element.name.text;
        info.imports.set(localName, {
          originModule: origin,
          originalName,
        });
      }
    }
    // `import defaultName from "..."` — we treat defaults as opaque; not relevant.
    // `import * as ns from "..."` — namespace; we cannot statically track
    //   `ns.appendMeta(...)` calls without deep alias tracking; left as
    //   indeterminate-via-omission (the call_target_name will return
    //   `appendMeta` from the Attribute, which only matches canonical_names
    //   if the namespace itself was somehow canonical — it won't be).
  } else if (
    ts.isExportDeclaration(node) &&
    node.moduleSpecifier !== undefined
  ) {
    // `export { X } from "..."` / `export { X as Y } from "..."`
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const origin = node.moduleSpecifier.text;
    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const originalName = element.propertyName
          ? element.propertyName.text
          : element.name.text;
        const exportedName = element.name.text;
        info.reExports.set(exportedName, {
          originModule: origin,
          originalName,
        });
        // Re-exports also bind the exported name locally for resolution
        // purposes — code in the same module can call the re-exported
        // name and it should resolve.
        info.imports.set(exportedName, {
          originModule: origin,
          originalName,
        });
      }
    }
  }
}

function collectAliases(node: ts.Node, info: ModuleInfo): void {
  if (!ts.isVariableStatement(node)) return;
  for (const decl of node.declarationList.declarations) {
    if (!ts.isIdentifier(decl.name)) continue;
    const init = decl.initializer;
    if (init && ts.isIdentifier(init)) {
      info.aliases.set(decl.name.text, init.text);
    }
  }
}

function collectFunctions(node: ts.Node, info: ModuleInfo): void {
  if (ts.isFunctionDeclaration(node) && node.name) {
    info.functions.set(node.name.text, node);
    return;
  }
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const init = decl.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        info.functions.set(decl.name.text, init);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tool-registration extraction
// ---------------------------------------------------------------------------
//
// Recognised shapes (any receiver — `server`, `mcp`, `app`, `this.mcp`):
//
//   1. `<x>.registerTool("name", configObject, asyncHandler)`         (3 args)
//   2. `<x>.tool("name", schemaObject, asyncHandler)`                  (3 args)
//   3. `<x>.tool("name", asyncHandler)`                                (2 args)
//   4. `<x>.registerTool({ name: "name", handler: asyncHandler })`     (object-config)
//   5. `<x>.addTool({ name: "name", handler: asyncHandler })`          (object-config)

function extractToolRegistration(node: ts.Node): ToolFn | null {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const method = callee.name.text;
  if (method !== "registerTool" && method !== "tool" && method !== "addTool") {
    return null;
  }
  const args = node.arguments;
  if (args.length === 0) return null;

  // String-name-first shape — first arg is a string literal.
  const first = args[0];
  if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
    const toolName = first.text;
    // Last arg with a function body is the handler.
    for (let i = args.length - 1; i >= 1; i--) {
      const arg = args[i];
      if (!arg) continue;
      if (
        ts.isArrowFunction(arg) ||
        ts.isFunctionExpression(arg)
      ) {
        return { name: toolName, body: arg };
      }
    }
    // No inline handler found — but the registration is still by name,
    // so we record an empty body. We use the call node itself as a
    // placeholder so `bodyCallsCanonical` returns false (which is the
    // correct outcome — no inline handler = no emission detected).
    return { name: toolName, body: node };
  }

  // Object-config shape — first arg is an object literal with `name` + `handler` keys.
  if (first && ts.isObjectLiteralExpression(first)) {
    let toolName: string | null = null;
    let handler: ts.Node | null = null;
    for (const prop of first.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const propName = propertyKey(prop);
      if (propName === "name") {
        const v = prop.initializer;
        if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) {
          toolName = v.text;
        }
      } else if (propName === "handler") {
        const v = prop.initializer;
        if (ts.isArrowFunction(v) || ts.isFunctionExpression(v)) {
          handler = v;
        }
      }
    }
    if (toolName !== null && handler !== null) {
      return { name: toolName, body: handler };
    }
  }

  return null;
}

function propertyKey(prop: ts.PropertyAssignment): string | null {
  if (ts.isIdentifier(prop.name)) return prop.name.text;
  if (ts.isStringLiteral(prop.name)) return prop.name.text;
  return null;
}

// ---------------------------------------------------------------------------
// Canonical-name propagation
// ---------------------------------------------------------------------------

function propagateCanonicalNames(
  modules: Map<string, ModuleInfo>,
  root: string,
): void {
  for (let pass = 0; pass < MAX_RESOLUTION_DEPTH + 1; pass++) {
    let changed = false;
    for (const [moduleKey, module] of modules) {
      for (const [localName, { originModule, originalName }] of module.imports) {
        if (module.canonicalNames.has(localName)) continue;
        if (isCanonicalImport(originModule, originalName)) {
          module.canonicalNames.add(localName);
          changed = true;
          continue;
        }
        const target = resolveModuleRef(originModule, moduleKey, modules, root);
        if (!target) continue;
        if (target.canonicalNames.has(originalName)) {
          module.canonicalNames.add(localName);
          changed = true;
        }
      }
      // Aliases inside the module body.
      for (const [aliasName, sourceName] of module.aliases) {
        if (module.canonicalNames.has(aliasName)) continue;
        if (module.canonicalNames.has(sourceName)) {
          module.canonicalNames.add(aliasName);
          changed = true;
        }
      }
      // Wrapper functions — any module-level function whose body
      // contains a call to an already-canonical name becomes canonical.
      for (const [fnName, fnNode] of module.functions) {
        if (module.canonicalNames.has(fnName)) continue;
        if (bodyCallsCanonical(fnNode, module.canonicalNames)) {
          module.canonicalNames.add(fnName);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

function isCanonicalImport(originModule: string, originalName: string): boolean {
  if (originalName !== CANONICAL_EMIT_NAME) return false;
  if (originModule === CANONICAL_LIB_PACKAGE) return true;
  return originModule.startsWith(CANONICAL_LIB_PACKAGE + "/");
}

function resolveModuleRef(
  originModule: string,
  fromModuleKey: string,
  modules: Map<string, ModuleInfo>,
  root: string,
): ModuleInfo | null {
  // Relative reference — resolve against fromModuleKey's directory.
  if (originModule.startsWith(".")) {
    const fromDir = fromModuleKey.includes("/")
      ? fromModuleKey.substring(0, fromModuleKey.lastIndexOf("/"))
      : "";
    const segments = originModule.split("/");
    const parts = fromDir.length > 0 ? fromDir.split("/") : [];
    for (const seg of segments) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    const candidate = parts.join("/").replace(/\.(ts|tsx|js)$/, "").replace(/\.js$/, "");
    // Try exact, .ts, /index variants.
    const tries = [candidate, candidate + "/index"];
    for (const t of tries) {
      if (modules.has(t)) return modules.get(t)!;
    }
    // Suffix match fallback.
    const suffixHit = findBySuffix(modules, candidate);
    if (suffixHit) return suffixHit;
    return null;
  }
  // Absolute / package-relative — match by suffix or exact path.
  if (modules.has(originModule)) return modules.get(originModule)!;
  void root;
  return findBySuffix(modules, originModule);
}

function findBySuffix(
  modules: Map<string, ModuleInfo>,
  candidate: string,
): ModuleInfo | null {
  const hits: string[] = [];
  for (const key of modules.keys()) {
    if (key === candidate || key.endsWith("/" + candidate)) {
      hits.push(key);
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.split("/").length - b.split("/").length);
  return modules.get(hits[0]!)!;
}

// ---------------------------------------------------------------------------
// Body inspection
// ---------------------------------------------------------------------------

function bodyCallsCanonical(node: ts.Node, canonicalNames: Set<string>): boolean {
  let found = false;
  function visit(n: ts.Node): void {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const target = callTargetName(n);
      if (target !== null && canonicalNames.has(target)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}

function callTargetName(call: ts.CallExpression): string | null {
  const fn = call.expression;
  if (ts.isIdentifier(fn)) return fn.text;
  if (ts.isPropertyAccessExpression(fn)) return fn.name.text;
  return null;
}

// ---------------------------------------------------------------------------
// Verdict construction
// ---------------------------------------------------------------------------

function buildVerdict(
  toolName: string,
  declared: string,
  fn: ToolFn | null,
  module: ModuleInfo | null,
): AuditSurfaceVerdict {
  if (declared === "none") {
    return {
      declared: "none",
      actual: "indeterminate",
      result: "match",
      detail:
        "audit_surface=none — tool returns byte payloads where the " +
        "_meta envelope is N/A; emission status is not inspected.",
    };
  }
  if (fn === null || module === null) {
    return {
      declared,
      actual: "indeterminate",
      result: "indeterminate",
      detail:
        `no function definition matched tool name "${toolName}" in the ` +
        "source tree (catalog name without a corresponding " +
        "registerTool/server.tool registration — may be registered " +
        "imperatively in a shape this lint does not statically resolve)",
    };
  }
  const emits = bodyCallsCanonical(fn.body, module.canonicalNames);
  const actual: "structured" | "minimal" = emits ? "structured" : "minimal";

  if (declared === "structured") {
    if (emits) {
      return {
        declared: "structured",
        actual: "structured",
        result: "match",
        detail:
          "tool handler calls appendMeta (directly or via a resolved " +
          "wrapper / re-export).",
      };
    }
    return {
      declared: "structured",
      actual: "minimal",
      result: "over-declared",
      detail:
        "catalog declares audit_surface=structured but tool handler " +
        "does not call appendMeta within the resolved emission " +
        `graph (depth ≤${MAX_RESOLUTION_DEPTH}).`,
    };
  }
  if (declared === "minimal") {
    if (emits) {
      return {
        declared: "minimal",
        actual: "structured",
        result: "under-declared",
        detail:
          "catalog declares audit_surface=minimal but tool handler " +
          "calls appendMeta — declare structured instead.",
      };
    }
    return {
      declared: "minimal",
      actual: "minimal",
      result: "match",
      detail:
        "catalog declares minimal and tool does not call appendMeta.",
    };
  }
  return {
    declared,
    actual,
    result: "indeterminate",
    detail:
      `unrecognised audit_surface value "${declared}" in catalog; ` +
      "expected one of structured / minimal / none.",
  };
}
