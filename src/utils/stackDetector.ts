import fs from "node:fs";
import path from "node:path";

export type Stack = "nestjs" | "nextjs" | "both" | "node";

export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: { node?: string };
}

export function readPackageJson(projectPath: string): PackageJson {
  const p = path.join(projectPath, "package.json");
  if (!fs.existsSync(p)) {
    throw new Error(`package.json not found at ${p}`);
  }
  const raw = fs.readFileSync(p, "utf8");
  try {
    return JSON.parse(raw) as PackageJson;
  } catch (err) {
    throw new Error(`package.json is not valid JSON: ${(err as Error).message}`);
  }
}

export function detectStack(projectPath: string): Stack {
  const pkg = readPackageJson(projectPath);
  return detectStackFromPackage(pkg);
}

export function detectStackFromPackage(pkg: PackageJson): Stack {
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const hasNest = "@nestjs/core" in all;
  const hasNext = "next" in all;
  if (hasNest && hasNext) return "both";
  if (hasNest) return "nestjs";
  if (hasNext) return "nextjs";
  return "node";
}

/** Parse a major version out of a version range string like `^10.2.1` or `~14.0.0`. */
export function parseMajor(version: string | undefined): number | null {
  if (!version) return null;
  const cleaned = version.replace(/^[\^~>=<\s]+/, "");
  const parts = cleaned.split(".");
  const major = parseInt(parts[0], 10);
  return Number.isFinite(major) ? major : null;
}
