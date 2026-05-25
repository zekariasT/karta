import http from "node:http";
import { validateProjectPath } from "../utils/paths.js";
import { detectStack } from "../utils/stackDetector.js";
import { buildNestjsGraph } from "../graphs/nestjsGraph.js";
import { buildNextjsGraph } from "../graphs/nextjsGraph.js";
import { buildGenericGraph } from "../graphs/genericGraph.js";
import { nestToViz, nextToViz, genericToViz, type VizGraph } from "./transform.js";
import { renderPage } from "./page.js";

export interface ViewerOptions {
  projectPath: string;
  port: number;
}

async function buildViz(projectPath: string): Promise<VizGraph> {
  const stack = detectStack(projectPath);
  if (stack === "nestjs") return nestToViz(await buildNestjsGraph(projectPath));
  if (stack === "nextjs") return nextToViz(await buildNextjsGraph(projectPath));
  if (stack === "both") {
    // Merge: prefix NestJS module ids and Next.js route ids so they don't collide.
    const [nest, next] = await Promise.all([
      buildNestjsGraph(projectPath),
      buildNextjsGraph(projectPath),
    ]);
    const nestViz = nestToViz(nest);
    const nextViz = nextToViz(next);
    return {
      nodes: [
        ...nestViz.nodes.map((n) => ({ ...n, id: "nest:" + n.id })),
        ...nextViz.nodes.map((n) => ({ ...n, id: "next:" + n.id })),
      ],
      links: [
        ...nestViz.links.map((l) => ({ ...l, source: "nest:" + l.source, target: "nest:" + l.target })),
        ...nextViz.links.map((l) => ({ ...l, source: "next:" + l.source, target: "next:" + l.target })),
      ],
      strategy: "full-stack",
      legend: [...nestViz.legend, ...nextViz.legend],
      summary: { nestjs: nestViz.summary, nextjs: nextViz.summary },
    };
  }
  return genericToViz(await buildGenericGraph(projectPath));
}

async function detectStrategy(projectPath: string): Promise<string> {
  try {
    const stack = detectStack(projectPath);
    if (stack === "nestjs") return "nestjs-module-graph";
    if (stack === "nextjs") return "nextjs-route-map";
    if (stack === "both") return "full-stack";
    return "file-import-graph";
  } catch {
    return "unknown";
  }
}

export async function startViewer(opts: ViewerOptions): Promise<void> {
  const absProject = validateProjectPath(opts.projectPath);
  const strategy = await detectStrategy(absProject);

  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.writeHead(400).end("Bad request");
        return;
      }
      const url = new URL(req.url, `http://localhost:${opts.port}`);

      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPage({ projectPath: absProject, strategy }));
        return;
      }

      if (url.pathname === "/favicon.ico") {
        res.writeHead(204).end();
        return;
      }

      if (url.pathname === "/api/graph") {
        const viz = await buildViz(absProject);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(viz));
        return;
      }

      res.writeHead(404).end("Not found");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: msg }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", () => resolve());
  });

  console.log(`karta viewer ready: http://localhost:${opts.port}`);
  console.log(`  project: ${absProject}`);
  console.log(`  strategy: ${strategy}`);
}
