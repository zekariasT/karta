import fs from "node:fs/promises";
import path from "node:path";
import { toRel } from "./paths.js";

export const DEFAULT_IGNORE = new Set<string>([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "build",
  "coverage",
  ".turbo",
]);

export interface WalkEntry {
  absPath: string;
  relPath: string;
  name: string;
  type: "file" | "folder";
  depth: number;
}

export interface WalkOptions {
  ignore?: Set<string>;
  maxDepth?: number;
  extensions?: string[]; // e.g. [".ts", ".tsx"] — applies to files only
}

export async function* walk(
  root: string,
  opts: WalkOptions = {}
): AsyncGenerator<WalkEntry> {
  const ignore = opts.ignore ?? DEFAULT_IGNORE;
  const maxDepth = opts.maxDepth ?? Infinity;
  const exts = opts.extensions;

  async function* visit(dir: string, depth: number): AsyncGenerator<WalkEntry> {
    if (depth > maxDepth) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (ignore.has(e.name)) continue;
      const abs = path.join(dir, e.name);
      const rel = toRel(root, abs);
      if (e.isDirectory()) {
        // When the caller filters by extension they want files only — skip the folder entry itself.
        if (!exts) {
          yield { absPath: abs, relPath: rel, name: e.name, type: "folder", depth };
        }
        yield* visit(abs, depth + 1);
      } else if (e.isFile()) {
        if (exts && !exts.some((x) => e.name.endsWith(x))) continue;
        yield { absPath: abs, relPath: rel, name: e.name, type: "file", depth };
      }
    }
  }

  yield* visit(root, 0);
}

export async function collect(
  root: string,
  opts: WalkOptions = {}
): Promise<WalkEntry[]> {
  const out: WalkEntry[] = [];
  for await (const e of walk(root, opts)) out.push(e);
  return out;
}
