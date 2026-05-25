import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { validateProjectPath, toRel } from "../utils/paths.js";
import { DEFAULT_IGNORE } from "../utils/fileWalker.js";
import { safe } from "../utils/result.js";

export const name = "read_project_structure";

export const description =
  "Return a nested JSON tree of folders and files for a target project. Use this FIRST when you need a quick mental map of an unfamiliar codebase before reading any files. Skips node_modules/.git/dist/.next/build/coverage/.turbo. Max depth 6.";

export const inputSchema = {
  projectPath: z
    .string()
    .describe("Absolute path to the project root to map."),
};

interface Node {
  name: string;
  type: "file" | "folder";
  path: string; // relative
  children?: Node[];
  truncated?: boolean;
}

const MAX_DEPTH = 6;

async function buildTree(
  projectPath: string,
  absDir: string,
  depth: number
): Promise<Node[]> {
  if (depth > MAX_DEPTH) return [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const out: Node[] = [];
  for (const e of entries) {
    if (DEFAULT_IGNORE.has(e.name)) continue;
    const abs = path.join(absDir, e.name);
    const rel = toRel(projectPath, abs);
    if (e.isDirectory()) {
      if (depth === MAX_DEPTH) {
        out.push({ name: e.name, type: "folder", path: rel, truncated: true });
      } else {
        out.push({
          name: e.name,
          type: "folder",
          path: rel,
          children: await buildTree(projectPath, abs, depth + 1),
        });
      }
    } else if (e.isFile()) {
      out.push({ name: e.name, type: "file", path: rel });
    }
  }
  return out;
}

export async function handler(args: { projectPath: string }) {
  return safe(async () => {
    const abs = validateProjectPath(args.projectPath);
    const children = await buildTree(abs, abs, 0);
    return {
      root: path.basename(abs),
      maxDepth: MAX_DEPTH,
      tree: { name: path.basename(abs), type: "folder", path: "", children },
    };
  });
}
