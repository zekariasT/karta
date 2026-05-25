import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { validateProjectPath, toRel } from "../utils/paths.js";
import { collect } from "../utils/fileWalker.js";
import { createProject, safeAddSourceFile } from "../utils/tsParser.js";
import { safe } from "../utils/result.js";
import { Node, SyntaxKind } from "ts-morph";

export const name = "find_relevant_files";

export const description =
  "Search a project for files related to a keyword. Looks at filenames, exported class/function names, and variable names. Returns up to 10 ranked matches with a 3-line snippet — use this to LOCATE code before reading whole files.";

export const inputSchema = {
  projectPath: z.string().describe("Absolute path to the project root."),
  keyword: z.string().describe("Substring to search for (case-insensitive)."),
};

type MatchType = "filename" | "class" | "function" | "variable";

interface Match {
  filePath: string;
  matchType: MatchType;
  matchedName: string;
  snippet: string;
  score: number;
  line: number;
}

const SCORE: Record<MatchType, number> = {
  filename: 3,
  class: 2,
  function: 2,
  variable: 1,
};

function snippetAround(lines: string[], lineNumber1: number): string {
  const idx = Math.max(0, lineNumber1 - 1);
  const start = Math.max(0, idx - 1);
  const end = Math.min(lines.length, idx + 2);
  return lines.slice(start, end).join("\n");
}

export async function handler(args: { projectPath: string; keyword: string }) {
  return safe(async () => {
    const abs = validateProjectPath(args.projectPath);
    const kw = (args.keyword ?? "").toLowerCase();
    if (!kw) throw new Error("keyword is required");

    const files = await collect(abs, { extensions: [".ts", ".tsx"] });
    const project = createProject();
    const matches: Match[] = [];
    const skipped: string[] = [];

    for (const f of files) {
      const rel = f.relPath;
      // Filename match first — cheap, no parse needed.
      if (path.basename(f.name).toLowerCase().includes(kw)) {
        let snippet = "";
        try {
          const text = await fs.readFile(f.absPath, "utf8");
          snippet = text.split(/\r?\n/).slice(0, 3).join("\n");
        } catch {
          /* ignore */
        }
        matches.push({
          filePath: rel,
          matchType: "filename",
          matchedName: f.name,
          snippet,
          score: SCORE.filename,
          line: 1,
        });
      }

      const src = safeAddSourceFile(project, f.absPath);
      if (!src) {
        skipped.push(rel);
        continue;
      }
      const text = src.getFullText();
      const lines = text.split(/\r?\n/);

      // Classes
      for (const cls of src.getClasses()) {
        const n = cls.getName();
        if (n && n.toLowerCase().includes(kw)) {
          matches.push({
            filePath: rel,
            matchType: "class",
            matchedName: n,
            snippet: snippetAround(lines, cls.getStartLineNumber()),
            score: SCORE.class,
            line: cls.getStartLineNumber(),
          });
        }
      }
      // Functions
      for (const fn of src.getFunctions()) {
        const n = fn.getName();
        if (n && n.toLowerCase().includes(kw)) {
          matches.push({
            filePath: rel,
            matchType: "function",
            matchedName: n,
            snippet: snippetAround(lines, fn.getStartLineNumber()),
            score: SCORE.function,
            line: fn.getStartLineNumber(),
          });
        }
      }
      // Top-level variables
      for (const stmt of src.getVariableStatements()) {
        for (const decl of stmt.getDeclarations()) {
          const n = decl.getName();
          if (n.toLowerCase().includes(kw)) {
            matches.push({
              filePath: rel,
              matchType: "variable",
              matchedName: n,
              snippet: snippetAround(lines, stmt.getStartLineNumber()),
              score: SCORE.variable,
              line: stmt.getStartLineNumber(),
            });
          }
        }
      }

      // Free memory — drop the source file from the project so we don't OOM on big repos.
      project.removeSourceFile(src);
      void Node;
      void SyntaxKind;
    }

    matches.sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath));
    return {
      keyword: args.keyword,
      matches: matches.slice(0, 10),
      totalCandidates: matches.length,
      skipped,
    };
  });
}
