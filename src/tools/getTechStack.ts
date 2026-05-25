import { z } from "zod";
import { validateProjectPath } from "../utils/paths.js";
import {
  detectStackFromPackage,
  parseMajor,
  readPackageJson,
  type Stack,
} from "../utils/stackDetector.js";
import { safe } from "../utils/result.js";

export const name = "get_tech_stack";

export const description =
  "Inspect package.json and report the detected framework (NestJS, Next.js, both, or plain Node), key dependencies with versions, and warnings about notably outdated frameworks. Call this BEFORE choosing how to read an unfamiliar codebase.";

export const inputSchema = {
  projectPath: z.string().describe("Absolute path to the project root."),
};

function frameworkLabel(stack: Stack): string {
  switch (stack) {
    case "nestjs":
      return "NestJS";
    case "nextjs":
      return "Next.js";
    case "both":
      return "NestJS + Next.js";
    default:
      return "Node.js";
  }
}

function asEntries(map?: Record<string, string>) {
  if (!map) return [];
  return Object.entries(map).map(([name, version]) => ({ name, version }));
}

export async function handler(args: { projectPath: string }) {
  return safe(async () => {
    const abs = validateProjectPath(args.projectPath);
    const pkg = readPackageJson(abs);
    const detectedStack = detectStackFromPackage(pkg);

    const deps = asEntries(pkg.dependencies);
    const devDeps = asEntries(pkg.devDependencies);

    const warnings: string[] = [];
    const nextVer = (pkg.dependencies?.next ?? pkg.devDependencies?.next) as
      | string
      | undefined;
    const nextMajor = parseMajor(nextVer);
    if (nextMajor !== null && nextMajor < 14) {
      warnings.push(`Next.js ${nextVer} is below 14 (consider upgrading).`);
    }
    const nestVer = (pkg.dependencies?.["@nestjs/core"] ??
      pkg.devDependencies?.["@nestjs/core"]) as string | undefined;
    const nestMajor = parseMajor(nestVer);
    if (nestMajor !== null && nestMajor < 10) {
      warnings.push(`@nestjs/core ${nestVer} is below 10 (consider upgrading).`);
    }

    return {
      detectedStack,
      framework: frameworkLabel(detectedStack),
      nodeVersion: pkg.engines?.node ?? null,
      dependencies: deps,
      devDependenciesSummary: {
        count: devDeps.length,
        topLevel: devDeps.slice(0, 20),
      },
      warnings,
    };
  });
}
