import { z } from "zod";
import { validateProjectPath } from "../utils/paths.js";
import { detectStack } from "../utils/stackDetector.js";
import { safe } from "../utils/result.js";
import { buildNestjsGraph } from "../graphs/nestjsGraph.js";
import { buildNextjsGraph } from "../graphs/nextjsGraph.js";
import { buildGenericGraph } from "../graphs/genericGraph.js";

export const name = "get_architecture_graph";

export const description =
  "Build a stack-aware architecture graph of the project. Picks the right strategy automatically: NestJS @Module decorator graph (with circular-import risks), Next.js route map (App or Pages Router), or a file import graph for plain Node/TS projects. Call this BEFORE making cross-file changes so you understand module relationships.";

export const inputSchema = {
  projectPath: z.string().describe("Absolute path to the project root."),
};

export async function handler(args: { projectPath: string }) {
  return safe(async () => {
    const abs = validateProjectPath(args.projectPath);
    const stack = detectStack(abs);

    if (stack === "nestjs") {
      return await buildNestjsGraph(abs);
    }
    if (stack === "nextjs") {
      return await buildNextjsGraph(abs);
    }
    if (stack === "both") {
      const [nestjs, nextjs] = await Promise.all([
        buildNestjsGraph(abs),
        buildNextjsGraph(abs),
      ]);
      return { strategy: "full-stack" as const, nestjs, nextjs };
    }
    return await buildGenericGraph(abs);
  });
}
