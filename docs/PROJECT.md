# Karta — Project Documentation

## 1. What Karta is

Karta is a **locally-running MCP (Model Context Protocol) server** that gives Claude Code a small set of stack-aware tools for reconnaissance on an unfamiliar codebase. Instead of letting Claude Code read files blindly or run grep across an entire repo, Karta lets it ask focused questions:

- *What stack is this?*
- *What's the folder shape?*
- *Where does the symbol `foo` live?*
- *What does this folder expose?*
- *How are the modules / routes / files related to each other?*

It also ships a small **interactive 3D viewer** (`karta-viewer`) that renders the same architecture graph in a browser.

Karta runs over **stdio** — Claude Code spawns it as a subprocess and exchanges JSON-RPC messages over its stdin/stdout. No network, no auth, no persistence.

---

## 2. Why it was built

Claude Code, like any agent, spends a lot of its early context window orienting itself in an unfamiliar codebase. The naïve options are expensive:

| Approach | Cost |
| --- | --- |
| Read every file | Eats context fast; most content is irrelevant |
| Grep for keywords | Returns text matches with no structural meaning (e.g. matches inside comments) |
| Ask the user | Slow; user often doesn't have the answer at their fingertips |

Karta fills the gap with **structured, summarized answers**: small JSON payloads that describe a project's shape without dumping its contents. The key constraints:

- **No full file contents** in responses — summaries and 3-line snippets only.
- **Per-tool response budget** of roughly 4000 tokens.
- **All paths relative** to the project root, never leaking absolute paths.
- **Stack-aware**: NestJS, Next.js, and plain Node TS each get a graph strategy tuned to their conventions, rather than a one-size-fits-all file graph.

The *interactive viewer* exists for the human in the loop — sometimes you want to look at the same graph Claude Code is looking at.

---

## 3. Architecture decisions

### 3.1 stdio transport

MCP supports several transports; stdio is the simplest and the one Claude Code uses for local servers. Stdio means:

- The MCP host (Claude Code) spawns Karta as a child process.
- Each JSON-RPC message is a single line on stdout.
- Replies are read from stdin.
- **stdout is sacred** — only protocol messages may go there. All Karta diagnostics use `console.error` (stderr).

This makes Karta zero-config: no port to allocate, no auth, no TLS, just a binary path in the user's `~/.claude.json`.

### 3.2 TypeScript strict + ESM

Strict mode catches every `any` and missing-null check; ESM (`"type": "module"`, `NodeNext` resolution) matches the MCP SDK and ts-morph's native module formats and avoids the CommonJS interop tax.

### 3.3 ts-morph for all AST work

Karta deliberately uses **no regex** on source code. Regex parsing is brittle (decorators have nested generics, JSX, optional commas, etc.). `ts-morph` is a thin, ergonomic wrapper around the TypeScript compiler API — it gives us a real AST with typed node guards (`Node.isObjectLiteralExpression(x)`, `Node.isCallExpression(x)`), `getExportedDeclarations()`, decorator lookup, and import resolution.

### 3.4 Tool result format: always JSON, always wrapped

Every tool returns one of two shapes:

```ts
{ content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] }
// or
{ content: [{ type: "text", text: errorMessage }], isError: true }
```

A shared `safe()` helper wraps each handler so any thrown error becomes the second shape rather than a process crash. The protocol allows structured `content`, but plain text JSON is the lowest-friction shape for Claude Code to read back.

### 3.5 Stateless

Karta keeps no cache, no database, no on-disk snapshots. Each tool call walks the filesystem fresh. The cost is re-walking; the benefit is correctness — you never see a stale answer after editing a file. A `~/.karta/snapshots/...` layer could be added later if a use case demands it.

### 3.6 Stack detector is a shared utility, not a tool

`get_tech_stack` and `get_architecture_graph` both need to know the stack. Putting `detectStack(projectPath)` in `utils/stackDetector.ts` keeps the rule in one place — change how stacks are detected and both tools update.

### 3.7 Strategy pattern for architecture graphs

`get_architecture_graph` is a dispatcher. The three strategy modules (`nestjsGraph`, `nextjsGraph`, `genericGraph`) each return a strategy-specific JSON shape with a `strategy:` discriminator. This means:

- The viewer's transform layer can switch on `strategy` to map each shape to a unified node/link form.
- Adding a new stack (Remix, SvelteKit, etc.) is one new file plus a one-line addition to the dispatcher — no other code changes.

### 3.8 The viewer is a separate bin

`karta` (MCP server, stdio) and `karta-viewer` (HTTP server, browser UI) share the same graph builders but have different runtimes. Keeping them as separate bins means:

- The MCP server never opens a port (security, simplicity).
- You can run the viewer without Claude Code, and vice versa.
- Stdio's "stdout is sacred" rule doesn't constrain the viewer.

The viewer uses plain Node `http` — no Express, no framework — to keep the dep footprint at just `@modelcontextprotocol/sdk`, `ts-morph`, and `zod`. The HTML page loads `3d-force-graph` from a CDN (pinned to `1.73.4`) so we never bundle a megabyte of WebGL into the npm package.

---

## 4. The five tools

Each tool lives in its own file under `src/tools/`. Every file exports the same four bindings: `name`, `description`, `inputSchema` (a Zod shape), and `handler`. The bootstrap in `src/index.ts` registers them with `server.registerTool(...)`.

The `description` string is **important**: it's what Claude Code reads to decide whether to call the tool. Each description tells Claude Code *when* to use it, not just *what* it does.

### 4.1 `read_project_structure`

> *Return a nested JSON tree of folders and files for a target project. Use this FIRST when you need a quick mental map of an unfamiliar codebase before reading any files.*

**Input:** `{ projectPath: string }`

**What it does:** Recursively walks the project, skipping `node_modules`, `.git`, `dist`, `.next`, `build`, `coverage`, `.turbo`. Caps at depth 6. Folders that hit the cap are marked `truncated: true`.

**Returns:**
```json
{
  "root": "Karta",
  "maxDepth": 6,
  "tree": {
    "name": "Karta", "type": "folder", "path": "",
    "children": [
      { "name": "src", "type": "folder", "path": "src", "children": [ ... ] },
      { "name": "package.json", "type": "file", "path": "package.json" }
    ]
  }
}
```

### 4.2 `get_tech_stack`

> *Inspect package.json and report the detected framework, key dependencies with versions, and warnings about notably outdated frameworks. Call this BEFORE choosing how to read an unfamiliar codebase.*

**Input:** `{ projectPath: string }`

**What it does:** Reads `package.json`, runs the stack detector, lists deps and devDeps, parses major versions of `next` and `@nestjs/core` and warns if Next.js < 14 or NestJS < 10.

**Returns:**
```json
{
  "detectedStack": "nestjs",
  "framework": "NestJS",
  "nodeVersion": ">=20",
  "dependencies": [{ "name": "@nestjs/core", "version": "^11.0.1" }, ...],
  "devDependenciesSummary": { "count": 20, "topLevel": [...] },
  "warnings": []
}
```

### 4.3 `find_relevant_files`

> *Search a project for files related to a keyword. Looks at filenames, exported class/function names, and variable names. Returns up to 10 ranked matches with a 3-line snippet — use this to LOCATE code before reading whole files.*

**Input:** `{ projectPath: string, keyword: string }`

**What it does:** Walks every `.ts`/`.tsx` file. For each, checks (1) filename, (2) class names, (3) function names, (4) top-level variable names. Scoring: filename = 3, class/function = 2, variable = 1. Sorts descending, caps at 10. Each match includes a 3-line snippet centered on the matched node.

**Returns:**
```json
{
  "keyword": "stack",
  "totalCandidates": 4,
  "matches": [
    { "filePath": "src/utils/stackDetector.ts", "matchType": "function", "matchedName": "detectStack", "line": 27, "snippet": "..." }
  ],
  "skipped": []
}
```

### 4.4 `get_module_summary`

> *Summarize the public surface of a folder. Loads every .ts file in the given folderPath (recursive) and reports its exported functions, classes, interfaces, and types plus a one-line inferred summary.*

**Input:** `{ projectPath: string, folderPath: string }`

**What it does:** Loads each `.ts` file in the folder. Calls `getExportedDeclarations()` and classifies each export (class / function / interface / type / const). Builds a one-line summary like `"Exports detectStack, parseMajor (functions); Stack (type)."` and optionally prepends a file-level JSDoc if present.

**Returns:**
```json
{
  "folder": "src/utils",
  "files": [
    {
      "file": "src/utils/stackDetector.ts",
      "exports": ["detectStack (function)", "Stack (type)"],
      "summary": "Exports readPackageJson, detectStack, ... (functions); Stack (type); PackageJson (interface).",
      "jsdoc": null
    }
  ],
  "skipped": []
}
```

### 4.5 `get_architecture_graph`

> *Build a stack-aware architecture graph of the project. Picks the right strategy automatically: NestJS @Module decorator graph (with circular-import risks), Next.js route map (App or Pages Router), or a file import graph for plain Node/TS projects.*

**Input:** `{ projectPath: string }`

**What it does:** Calls `detectStack`, dispatches to one of three strategies:

#### NestJS strategy (`strategy: "nestjs-module-graph"`)
- Loads all `.ts` files under `src/`.
- For every `ClassDeclaration` with an `@Module(...)` decorator:
  - Reads the decorator's first argument as an `ObjectLiteralExpression`.
  - Extracts `imports`, `providers`, `exports` (and `controllers`).
  - For each array element, resolves a name string: `Identifier` → text, `CallExpression` (`X.forRoot(...)`) → `X.forRoot`, `ObjectLiteralExpression` (provider config) → flattened `{ provide: X, useClass: Y }`, `SpreadElement` → `...expr`.
- Second pass: a module is `isShared` if any other module imports it.
- Cycle detection via DFS with grey/black coloring; cycles are deduplicated and reported as `"A -> B -> A"`.

Returns: `{ strategy, modules[], circularRisks[], skipped[] }`.

#### Next.js strategy (`strategy: "nextjs-route-map"`)
- Detects `app/` (App Router) and/or `pages/` (Pages Router) at the project root or under `src/`.
- If both exist, prefers App Router and warns.
- **App Router**: walks `app/`, recognizes `page.{tsx,ts,jsx,js}`, `layout.*`, `loading.*`, `error.*`. Route = directory path with `(route-group)` segments stripped; `[param]` preserved. For pages and layouts, reads the first ~512 bytes of the file to check for the `"use client"` directive and sets `isClientComponent`.
- **Pages Router**: every file under `pages/` is a route except `_app`, `_document`, `_error`. Files under `pages/api/` are typed `"api"`. `index.tsx` collapses to its parent (`/users/index.tsx` → `/users`).

Returns: `{ strategy, routerType, routes[], warnings[], skipped[] }`.

#### Generic strategy (`strategy: "file-import-graph"`)
- Walks all `.ts`/`.tsx` files under `src/` (or project root if no `src/`).
- For each file, gets `getImportDeclarations()`. Keeps only local imports (specifier starts with `.` or `/`). Resolves each to a file via `getModuleSpecifierSourceFile()`.
- Builds a reverse index (`importedBy`). Files with 3+ importers are flagged `isHub: true`.

Returns: `{ strategy, files[], skipped[] }`.

#### Both (`strategy: "full-stack"`)
Runs both NestJS and Next.js strategies in parallel and returns `{ strategy: "full-stack", nestjs: {...}, nextjs: {...} }`.

---

## 5. Stack detection logic

`src/utils/stackDetector.ts` exposes one function:

```ts
detectStack(projectPath: string): "nestjs" | "nextjs" | "both" | "node"
```

The rule is intentionally minimal:

1. Read `package.json` at the project root. Throws a clear error if missing or invalid JSON.
2. Merge `dependencies` and `devDependencies` into a single key set.
3. Check for the presence of `@nestjs/core` (the Nest framework core, always present in a Nest project).
4. Check for the presence of `next` (the Next.js package).
5. Return `"both"` if both, otherwise whichever one matched, otherwise `"node"`.

This is checked against the package set rather than parsed from files because it's *cheap*, *deterministic*, and matches how project setup works in practice — you can't be a NestJS project without installing `@nestjs/core`.

A companion `parseMajor(versionString)` strips `^`/`~`/`>=` and returns the first integer segment, used for the outdated-framework warnings. No `semver` dep needed.

---

## 6. Project layout

```
Karta/
  package.json                bins: karta, karta-viewer
  tsconfig.json               strict, NodeNext, target ES2022
  README.md
  src/
    index.ts                  MCP server bootstrap, registers all 5 tools, stdio transport
    tools/
      readProjectStructure.ts
      getTechStack.ts
      findRelevantFiles.ts
      getModuleSummary.ts
      getArchitectureGraph.ts
    graphs/
      genericGraph.ts         file-import-graph strategy
      nextjsGraph.ts          nextjs-route-map strategy
      nestjsGraph.ts          nestjs-module-graph strategy (@Module AST parse + cycle detection)
    utils/
      paths.ts                validateProjectPath, toRel
      fileWalker.ts           recursive walk with ignore set + depth cap
      tsParser.ts             ts-morph Project factory + safeAddSourceFile
      stackDetector.ts        detectStack, readPackageJson, parseMajor
      result.ts               ok / err / safe wrappers
    viewer/
      cli.ts                  karta-viewer entry (arg parsing)
      server.ts               plain Node http server, / and /api/graph
      transform.ts            strategy-aware → { nodes, links } normalization
      page.ts                 inlined HTML page with 3d-force-graph
  dist/                       tsc output (gitignored)
```

---

## 7. Build order

This was the order the project was built in. It's the order to use again if the project is rewritten:

1. Scaffold `package.json` + `tsconfig.json`, `npm install`.
2. `utils/paths.ts`, `utils/fileWalker.ts`, `utils/tsParser.ts`, `utils/result.ts`.
3. `utils/stackDetector.ts`.
4. `tools/readProjectStructure.ts` — simplest tool, no AST. Verifies the walker.
5. `tools/getTechStack.ts` — exercises the stack detector.
6. `tools/findRelevantFiles.ts` — first AST tool.
7. `tools/getModuleSummary.ts` — exercises `getExportedDeclarations`.
8. `graphs/genericGraph.ts` — simplest graph (import edges only).
9. `graphs/nextjsGraph.ts` — walks special filenames in `app/` or `pages/`.
10. `graphs/nestjsGraph.ts` — most complex (decorator AST parsing + cycle detection).
11. `tools/getArchitectureGraph.ts` — wires the three strategies behind the stack detector.
12. `src/index.ts` — registers all tools, opens stdio transport.
13. `npm run build`, smoke-test with raw JSON-RPC on stdin.
14. Viewer: `viewer/transform.ts` → `viewer/page.ts` → `viewer/server.ts` → `viewer/cli.ts`.

The order matters because each step depends on the previous one and is testable independently. Anything that fails to compile catches at its own step rather than at the end.

---

## 8. Registering and using with Claude Code

### Build

```bash
cd /home/zac/Documents/profile/Karta
npm install
npm run build
```

This produces `dist/index.js` (MCP server) and `dist/viewer/cli.js` (viewer).

### Register

```bash
claude mcp add karta -- node /home/zac/Documents/profile/Karta/dist/index.js
```

This writes a `karta` entry into `~/.claude.json` under the current project. Verify:

```bash
claude mcp list
# karta: node /home/zac/Documents/profile/Karta/dist/index.js - ✓ Connected
```

To register globally (available in every project), use `claude mcp add --scope user karta -- node /path/to/dist/index.js`.

### Use

Inside a Claude Code session, Claude can now call the five tools by name. You don't usually call them directly — you ask normal questions and Claude picks the tool. Examples:

- *"What kind of project is this?"* → Claude calls `get_tech_stack`.
- *"Show me the folder shape"* → Claude calls `read_project_structure`.
- *"Where does AuthGuard live?"* → Claude calls `find_relevant_files` with `keyword: "AuthGuard"`.
- *"What does the users module export?"* → Claude calls `get_module_summary` with `folderPath: "src/users"`.
- *"What modules does this NestJS app have and what depends on what?"* → Claude calls `get_architecture_graph`.

### Visualize

For the human in the loop:

```bash
npm run viewer -- --project /path/to/some/project
# or
karta-viewer --project /path/to/some/project --port 3737
```

Open <http://localhost:3737>. Drag to rotate, scroll to zoom, click a node to see its meta.

### Error handling

Pass a nonexistent `projectPath` to any tool and you get:

```json
{
  "content": [{ "type": "text", "text": "projectPath does not exist: /nope" }],
  "isError": true
}
```

The server itself never crashes. Files that ts-morph can't parse are pushed into a `skipped[]` array on the response rather than aborting the whole call.

---

## 9. What it does *not* do

- **No persistence.** Every call re-walks the filesystem.
- **No write tools.** Karta is read-only.
- **No symbol-level semantics.** It doesn't know that `UsersService` and `UsersService` in two files are the same class — they're just strings to it.
- **No multi-repo support.** One `projectPath` per call.
- **No streaming.** Each tool returns its full payload at once. For very large projects this can exceed the ~4000-token response budget; mitigations (filename match limit, depth cap, no file bodies in graphs) are in place but not guarantees.

These are all intentional — they're either future scope or out of scope for what Karta is meant to do.
