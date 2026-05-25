import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { validateProjectPath, toRel } from "../utils/paths.js";
import { collect } from "../utils/fileWalker.js";
import { createProject, safeAddSourceFile } from "../utils/tsParser.js";
import { safe } from "../utils/result.js";
import {
  SourceFile,
  ClassDeclaration,
  FunctionDeclaration,
  InterfaceDeclaration,
  TypeAliasDeclaration,
  VariableDeclaration,
  Node,
} from "ts-morph";

export const name = "get_module_summary";

export const description =
  "Summarize the public surface of a folder. Loads every .ts file in the given folderPath (recursive) and reports its exported functions, classes, interfaces, and types plus a one-line inferred summary. Use this to understand a module without reading every file.";

export const inputSchema = {
  projectPath: z.string().describe("Absolute path to the project root."),
  folderPath: z
    .string()
    .describe("Folder to summarize, relative to projectPath (e.g. 'src/users')."),
};

interface FileSummary {
  file: string;
  exports: string[];
  summary: string;
  jsdoc: string | null;
}

function classifyExport(d: Node): { name: string; kind: string } | null {
  if (Node.isClassDeclaration(d) || d instanceof ClassDeclaration) {
    const n = (d as ClassDeclaration).getName();
    return n ? { name: n, kind: "class" } : null;
  }
  if (Node.isFunctionDeclaration(d) || d instanceof FunctionDeclaration) {
    const n = (d as FunctionDeclaration).getName();
    return n ? { name: n, kind: "function" } : null;
  }
  if (Node.isInterfaceDeclaration(d) || d instanceof InterfaceDeclaration) {
    return { name: (d as InterfaceDeclaration).getName(), kind: "interface" };
  }
  if (Node.isTypeAliasDeclaration(d) || d instanceof TypeAliasDeclaration) {
    return { name: (d as TypeAliasDeclaration).getName(), kind: "type" };
  }
  if (Node.isVariableDeclaration(d) || d instanceof VariableDeclaration) {
    return { name: (d as VariableDeclaration).getName(), kind: "const" };
  }
  return null;
}

function leadingJsDoc(src: SourceFile): string | null {
  // Try file-level: first statement's JSDoc, or comments at top.
  const first = src.getStatements()[0];
  if (!first) return null;
  const docs = (first as unknown as { getJsDocs?: () => { getDescription(): string }[] })
    .getJsDocs?.();
  if (docs && docs.length > 0) {
    const text = docs[0].getDescription().trim();
    if (text) return text.split(/\r?\n/)[0];
  }
  // Fallback: leading comment ranges on file
  const leading = src.getLeadingCommentRanges?.();
  if (leading && leading.length > 0) {
    const raw = leading[0].getText().replace(/^\/\*\*?|\*\/$/g, "").trim();
    const firstLine = raw
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .find((l) => l.length > 0);
    if (firstLine) return firstLine;
  }
  return null;
}

function pluralize(kind: string, count: number): string {
  if (count <= 1) return kind;
  if (kind.endsWith("s") || kind.endsWith("x") || kind.endsWith("ch")) return `${kind}es`;
  return `${kind}s`;
}

function inferSummary(items: { name: string; kind: string }[]): string {
  if (items.length === 0) return "No exports detected.";
  const grouped: Record<string, string[]> = {};
  for (const it of items) {
    (grouped[it.kind] ??= []).push(it.name);
  }
  const parts = Object.entries(grouped).map(
    ([kind, names]) => `${names.join(", ")} (${pluralize(kind, names.length)})`
  );
  return `Exports ${parts.join("; ")}.`;
}

export async function handler(args: {
  projectPath: string;
  folderPath: string;
}) {
  return safe(async () => {
    const abs = validateProjectPath(args.projectPath);
    const folderAbs = path.resolve(abs, args.folderPath);
    if (!fs.existsSync(folderAbs) || !fs.statSync(folderAbs).isDirectory()) {
      throw new Error(`folderPath does not exist or is not a directory: ${args.folderPath}`);
    }

    const files = await collect(folderAbs, { extensions: [".ts", ".tsx"] });
    const project = createProject();
    const summaries: FileSummary[] = [];
    const skipped: string[] = [];

    for (const f of files) {
      const src = safeAddSourceFile(project, f.absPath);
      if (!src) {
        skipped.push(toRel(abs, f.absPath));
        continue;
      }
      const items: { name: string; kind: string }[] = [];
      const exportedMap = src.getExportedDeclarations();
      for (const [exportName, decls] of exportedMap) {
        let classified: { name: string; kind: string } | null = null;
        for (const d of decls) {
          classified = classifyExport(d);
          if (classified) break;
        }
        items.push(classified ?? { name: exportName, kind: "value" });
      }
      const jsdoc = leadingJsDoc(src);
      summaries.push({
        file: toRel(abs, f.absPath),
        exports: items.map((i) => `${i.name} (${i.kind})`),
        summary: jsdoc ? `${jsdoc} — ${inferSummary(items)}` : inferSummary(items),
        jsdoc,
      });
      project.removeSourceFile(src);
    }

    return {
      folder: args.folderPath,
      files: summaries,
      skipped,
    };
  });
}
