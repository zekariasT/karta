import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { collect } from "../utils/fileWalker.js";
import { toRel } from "../utils/paths.js";

export type NextRouteType = "page" | "layout" | "api" | "loading" | "error";

export interface NextRoute {
  route: string;
  filePath: string;
  type: NextRouteType;
  isClientComponent: boolean;
}

export interface NextGraphResult {
  strategy: "nextjs-route-map";
  routerType: "app" | "pages";
  routes: NextRoute[];
  warnings: string[];
  skipped: string[];
}

const ROUTE_EXTS = [".tsx", ".ts", ".jsx", ".js"];

function stripExt(name: string): { base: string; ext: string } | null {
  for (const ext of ROUTE_EXTS) {
    if (name.endsWith(ext)) return { base: name.slice(0, -ext.length), ext };
  }
  return null;
}

async function hasUseClientDirective(absPath: string): Promise<boolean> {
  try {
    const fh = await fsp.open(absPath, "r");
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    await fh.close();
    const text = buf.subarray(0, bytesRead).toString("utf8");
    // Look at the first non-comment, non-blank line(s)
    const lines = text.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (line === "") continue;
      if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
      return /^["']use client["']/.test(line);
    }
    return false;
  } catch {
    return false;
  }
}

/** Convert an app-router directory path (relative to app/) into a route string. */
function appDirToRoute(relDir: string): string {
  const segs = relDir.split("/").filter(Boolean);
  const kept = segs.filter((s) => !/^\(.*\)$/.test(s)); // strip route groups (group)
  return "/" + kept.join("/");
}

/** Convert a pages-router file path (relative to pages/, without ext) into a route string. */
function pagesFileToRoute(relPath: string): string {
  let route = "/" + relPath.split("/").filter(Boolean).join("/");
  route = route.replace(/\/index$/, "") || "/";
  return route;
}

async function buildAppRouter(
  projectPath: string,
  appAbs: string
): Promise<NextRoute[]> {
  const entries = await collect(appAbs, { extensions: ROUTE_EXTS });
  const routes: NextRoute[] = [];
  for (const e of entries) {
    const parsed = stripExt(e.name);
    if (!parsed) continue;
    let type: NextRouteType | null = null;
    if (parsed.base === "page") type = "page";
    else if (parsed.base === "layout") type = "layout";
    else if (parsed.base === "loading") type = "loading";
    else if (parsed.base === "error") type = "error";
    else continue;

    const relFromApp = toRel(appAbs, path.dirname(e.absPath));
    const route = appDirToRoute(relFromApp);
    routes.push({
      route,
      filePath: toRel(projectPath, e.absPath),
      type,
      isClientComponent: type === "page" || type === "layout"
        ? await hasUseClientDirective(e.absPath)
        : false,
    });
  }
  routes.sort((a, b) => a.route.localeCompare(b.route) || a.type.localeCompare(b.type));
  return routes;
}

async function buildPagesRouter(
  projectPath: string,
  pagesAbs: string
): Promise<NextRoute[]> {
  const entries = await collect(pagesAbs, { extensions: ROUTE_EXTS });
  const routes: NextRoute[] = [];
  for (const e of entries) {
    const parsed = stripExt(e.name);
    if (!parsed) continue;
    if (["_app", "_document", "_error"].includes(parsed.base)) continue;

    const relFromPages = toRel(pagesAbs, e.absPath);
    const relNoExt = relFromPages.slice(0, -parsed.ext.length);
    const isApi = relFromPages.startsWith("api/");
    const route = pagesFileToRoute(relNoExt);

    routes.push({
      route: isApi ? "/" + relNoExt : route,
      filePath: toRel(projectPath, e.absPath),
      type: isApi ? "api" : "page",
      isClientComponent: false, // Pages Router does not use the "use client" directive
    });
  }
  routes.sort((a, b) => a.route.localeCompare(b.route));
  return routes;
}

export async function buildNextjsGraph(
  projectPath: string
): Promise<NextGraphResult> {
  const warnings: string[] = [];
  // Look at both project root and src/ — Next.js supports both layouts.
  const candidates = [
    { app: path.join(projectPath, "app"), pages: path.join(projectPath, "pages") },
    { app: path.join(projectPath, "src", "app"), pages: path.join(projectPath, "src", "pages") },
  ];
  let appAbs: string | null = null;
  let pagesAbs: string | null = null;
  for (const c of candidates) {
    if (!appAbs && fs.existsSync(c.app) && fs.statSync(c.app).isDirectory()) appAbs = c.app;
    if (!pagesAbs && fs.existsSync(c.pages) && fs.statSync(c.pages).isDirectory()) pagesAbs = c.pages;
  }

  if (appAbs && pagesAbs) {
    warnings.push(
      "Both app/ and pages/ exist — preferring App Router. Pages Router routes were skipped."
    );
  }

  if (appAbs) {
    const routes = await buildAppRouter(projectPath, appAbs);
    return { strategy: "nextjs-route-map", routerType: "app", routes, warnings, skipped: [] };
  }
  if (pagesAbs) {
    const routes = await buildPagesRouter(projectPath, pagesAbs);
    return { strategy: "nextjs-route-map", routerType: "pages", routes, warnings, skipped: [] };
  }
  return {
    strategy: "nextjs-route-map",
    routerType: "app",
    routes: [],
    warnings: ["Next.js detected in package.json but no app/ or pages/ directory was found."],
    skipped: [],
  };
}
