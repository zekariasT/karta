import fs from "node:fs";
import path from "node:path";

export function validateProjectPath(projectPath: string): string {
  if (!projectPath || typeof projectPath !== "string") {
    throw new Error("projectPath is required and must be a string");
  }
  const abs = path.resolve(projectPath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new Error(`projectPath does not exist: ${projectPath}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`projectPath is not a directory: ${projectPath}`);
  }
  return abs;
}

export function toRel(projectPath: string, absPath: string): string {
  const rel = path.relative(projectPath, absPath);
  // POSIX-style separators so output is stable across platforms
  return rel.split(path.sep).join("/");
}

export function joinRel(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}
