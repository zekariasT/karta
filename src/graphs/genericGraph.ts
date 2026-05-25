import fs from "node:fs";
import path from "node:path";
import { collect } from "../utils/fileWalker.js";
import { createProject, safeAddSourceFile } from "../utils/tsParser.js";
import { toRel } from "../utils/paths.js";

export interface GenericFileNode {
  filePath: string;
  imports: string[];
  importedBy: string[];
  isHub: boolean;
}

export interface GenericGraphResult {
  strategy: "file-import-graph";
  files: GenericFileNode[];
  skipped: string[];
}

export async function buildGenericGraph(
  projectPath: string
): Promise<GenericGraphResult> {
  const srcDir = path.join(projectPath, "src");
  const root = fs.existsSync(srcDir) ? srcDir : projectPath;
  const files = await collect(root, { extensions: [".ts", ".tsx"] });

  const project = createProject();
  const fileMap = new Map<
    string,
    { rel: string; imports: Set<string> }
  >();
  const skipped: string[] = [];

  for (const f of files) {
    const src = safeAddSourceFile(project, f.absPath);
    if (!src) {
      skipped.push(toRel(projectPath, f.absPath));
      continue;
    }
    fileMap.set(f.absPath, {
      rel: toRel(projectPath, f.absPath),
      imports: new Set<string>(),
    });
  }

  for (const [absPath, entry] of fileMap) {
    const src = project.getSourceFile(absPath);
    if (!src) continue;
    for (const imp of src.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue();
      if (!spec.startsWith(".") && !spec.startsWith("/")) continue; // skip externals
      const target = imp.getModuleSpecifierSourceFile();
      if (target) {
        const targetAbs = target.getFilePath();
        if (fileMap.has(targetAbs)) {
          entry.imports.add(toRel(projectPath, targetAbs));
        } else {
          // Out of scope but still local — record raw specifier resolved against file dir
          const resolved = path.resolve(path.dirname(absPath), spec);
          entry.imports.add(toRel(projectPath, resolved));
        }
      } else {
        const resolved = path.resolve(path.dirname(absPath), spec);
        entry.imports.add(toRel(projectPath, resolved));
      }
    }
  }

  // Build reverse index
  const importedBy = new Map<string, Set<string>>();
  for (const entry of fileMap.values()) {
    for (const imp of entry.imports) {
      if (!importedBy.has(imp)) importedBy.set(imp, new Set());
      importedBy.get(imp)!.add(entry.rel);
    }
  }

  const result: GenericFileNode[] = [];
  for (const entry of fileMap.values()) {
    const importers = importedBy.get(entry.rel) ?? new Set();
    result.push({
      filePath: entry.rel,
      imports: [...entry.imports].sort(),
      importedBy: [...importers].sort(),
      isHub: importers.size >= 3,
    });
  }
  result.sort((a, b) => a.filePath.localeCompare(b.filePath));

  return { strategy: "file-import-graph", files: result, skipped };
}
