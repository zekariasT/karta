import fs from "node:fs";
import path from "node:path";
import { collect } from "../utils/fileWalker.js";
import { createProject, safeAddSourceFile } from "../utils/tsParser.js";
import { toRel } from "../utils/paths.js";
import {
  ObjectLiteralExpression,
  ArrayLiteralExpression,
  PropertyAssignment,
  Node,
} from "ts-morph";

export interface NestModule {
  name: string;
  filePath: string;
  imports: string[];
  providers: string[];
  exports: string[];
  isShared: boolean;
}

export interface NestGraphResult {
  strategy: "nestjs-module-graph";
  modules: NestModule[];
  circularRisks: string[];
  skipped: string[];
}

const MODULE_KEYS = ["imports", "providers", "exports", "controllers"] as const;

function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function describeProviderObject(obj: ObjectLiteralExpression): string {
  const provideProp = obj.getProperty("provide");
  const provideText =
    provideProp instanceof PropertyAssignment
      ? flatten(provideProp.getInitializer()?.getText() ?? "")
      : "?";
  for (const useKey of ["useClass", "useExisting", "useValue", "useFactory"]) {
    const p = obj.getProperty(useKey);
    if (p instanceof PropertyAssignment) {
      const valText = flatten(p.getInitializer()?.getText() ?? "");
      return `{ provide: ${provideText}, ${useKey}: ${valText} }`;
    }
  }
  return flatten(obj.getText());
}

function nameFromArrayElement(el: Node): string {
  if (Node.isIdentifier(el)) return el.getText();
  if (Node.isCallExpression(el)) {
    // e.g. TypeOrmModule.forRoot({ ... })
    return el.getExpression().getText();
  }
  if (Node.isSpreadElement(el)) {
    return "..." + el.getExpression().getText();
  }
  if (Node.isObjectLiteralExpression(el)) {
    return describeProviderObject(el);
  }
  return flatten(el.getText());
}

function readListProperty(
  obj: ObjectLiteralExpression,
  key: string
): string[] {
  const prop = obj.getProperty(key);
  if (!prop) return [];
  if (!(prop instanceof PropertyAssignment) && !Node.isPropertyAssignment(prop))
    return [];
  const init = (prop as PropertyAssignment).getInitializer();
  if (!init) return [];
  if (!Node.isArrayLiteralExpression(init)) return [];
  const arr = init as ArrayLiteralExpression;
  return arr.getElements().map(nameFromArrayElement);
}

function findCycles(graph: Map<string, string[]>): string[] {
  const cycles: string[] = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of graph.keys()) color.set(n, WHITE);

  function dfs(node: string, stack: string[]) {
    color.set(node, GRAY);
    stack.push(node);
    for (const nbr of graph.get(node) ?? []) {
      const c = color.get(nbr);
      if (c === GRAY) {
        const idx = stack.indexOf(nbr);
        const cycle = stack.slice(idx).concat(nbr).join(" -> ");
        cycles.push(cycle);
      } else if (c === WHITE || c === undefined) {
        if (!graph.has(nbr)) {
          // unknown module — still walk minimally to surface declared edges
          color.set(nbr, BLACK);
          continue;
        }
        dfs(nbr, stack);
      }
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const n of graph.keys()) {
    if (color.get(n) === WHITE) dfs(n, []);
  }
  // Deduplicate (same cycle from different start points)
  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const c of cycles) {
    const parts = c.split(" -> ");
    // canonicalize: rotate so the smallest name comes first
    const nodes = parts.slice(0, -1); // drop trailing repeat
    let minIdx = 0;
    for (let i = 1; i < nodes.length; i++) {
      if (nodes[i] < nodes[minIdx]) minIdx = i;
    }
    const rotated = nodes.slice(minIdx).concat(nodes.slice(0, minIdx));
    const key = rotated.join("->");
    if (!seen.has(key)) {
      seen.add(key);
      dedup.push(rotated.concat(rotated[0]).join(" -> "));
    }
  }
  return dedup;
}

export async function buildNestjsGraph(
  projectPath: string
): Promise<NestGraphResult> {
  const srcDir = path.join(projectPath, "src");
  const root = fs.existsSync(srcDir) ? srcDir : projectPath;
  const files = await collect(root, { extensions: [".ts"] });

  const project = createProject();
  const modules: NestModule[] = [];
  const skipped: string[] = [];

  for (const f of files) {
    const src = safeAddSourceFile(project, f.absPath);
    if (!src) {
      skipped.push(toRel(projectPath, f.absPath));
      continue;
    }
    for (const cls of src.getClasses()) {
      const decorator = cls.getDecorator("Module");
      if (!decorator) continue;
      const args = decorator.getArguments();
      if (args.length === 0) continue;
      const firstArg = args[0];
      if (!Node.isObjectLiteralExpression(firstArg)) {
        skipped.push(`${toRel(projectPath, f.absPath)} (@Module arg is not an object literal)`);
        continue;
      }
      const obj = firstArg as ObjectLiteralExpression;
      const name = cls.getName() ?? "AnonymousModule";
      modules.push({
        name,
        filePath: toRel(projectPath, f.absPath),
        imports: readListProperty(obj, "imports"),
        providers: readListProperty(obj, "providers"),
        exports: readListProperty(obj, "exports"),
        isShared: false,
      });
    }
    project.removeSourceFile(src);
  }

  // isShared: imported by any other module
  const importedSomewhere = new Set<string>();
  for (const m of modules) {
    for (const imp of m.imports) {
      // strip .forRoot / .forFeature suffix for matching
      const baseName = imp.split(".")[0].replace(/^\.\.\./, "");
      importedSomewhere.add(baseName);
    }
  }
  for (const m of modules) {
    if (importedSomewhere.has(m.name)) m.isShared = true;
  }

  // Build graph for cycle detection (by module class name)
  const graph = new Map<string, string[]>();
  for (const m of modules) {
    graph.set(
      m.name,
      m.imports.map((i) => i.split(".")[0].replace(/^\.\.\./, ""))
    );
  }
  const circularRisks = findCycles(graph);
  void MODULE_KEYS; // referenced for type-list completeness

  modules.sort((a, b) => a.name.localeCompare(b.name));
  return {
    strategy: "nestjs-module-graph",
    modules,
    circularRisks,
    skipped,
  };
}
