import type { NestGraphResult, NestModule } from "../graphs/nestjsGraph.js";
import type { NextGraphResult, NextRoute } from "../graphs/nextjsGraph.js";
import type { GenericGraphResult, GenericFileNode } from "../graphs/genericGraph.js";

export interface VizNode {
  id: string;
  label: string;
  group: string;
  size?: number;
  meta: Record<string, unknown>;
}

export interface VizLink {
  source: string;
  target: string;
  kind: string;
}

export interface VizGraph {
  nodes: VizNode[];
  links: VizLink[];
  strategy: string;
  legend: { group: string; description: string }[];
  summary: Record<string, unknown>;
}

/** Strip `.forRoot(...)` / `.forFeature(...)` suffix to match against module class names. */
function baseModuleName(raw: string): string {
  return raw.replace(/^\.\.\./, "").split(".")[0];
}

export function nestToViz(g: NestGraphResult): VizGraph {
  const moduleNames = new Set(g.modules.map((m) => m.name));
  const nodes: VizNode[] = g.modules.map((m: NestModule) => ({
    id: m.name,
    label: m.name,
    group: m.isShared ? "shared" : "leaf",
    size: 4 + m.providers.length,
    meta: {
      filePath: m.filePath,
      providers: m.providers,
      exports: m.exports,
      imports: m.imports,
      isShared: m.isShared,
    },
  }));
  const links: VizLink[] = [];
  for (const m of g.modules) {
    for (const imp of m.imports) {
      const base = baseModuleName(imp);
      if (moduleNames.has(base)) {
        links.push({ source: m.name, target: base, kind: "imports" });
      }
    }
  }
  return {
    nodes,
    links,
    strategy: g.strategy,
    legend: [
      { group: "shared", description: "Imported by another module" },
      { group: "leaf", description: "Not imported elsewhere (typically the root AppModule)" },
    ],
    summary: {
      modules: g.modules.length,
      circularRisks: g.circularRisks,
      skipped: g.skipped.length,
    },
  };
}

export function genericToViz(g: GenericGraphResult): VizGraph {
  const nodes: VizNode[] = g.files.map((f: GenericFileNode) => ({
    id: f.filePath,
    label: f.filePath.split("/").pop() ?? f.filePath,
    group: f.isHub ? "hub" : f.imports.length === 0 ? "entry" : "leaf",
    size: 3 + Math.min(f.importedBy.length, 12),
    meta: {
      filePath: f.filePath,
      imports: f.imports,
      importedBy: f.importedBy,
      isHub: f.isHub,
    },
  }));
  const known = new Set(nodes.map((n) => n.id));
  const links: VizLink[] = [];
  for (const f of g.files) {
    for (const imp of f.imports) {
      if (known.has(imp)) {
        links.push({ source: f.filePath, target: imp, kind: "imports" });
      }
    }
  }
  return {
    nodes,
    links,
    strategy: g.strategy,
    legend: [
      { group: "hub", description: "Imported by 3+ files" },
      { group: "leaf", description: "Imported by 1–2 files" },
      { group: "entry", description: "Imports nothing local (likely an entry point or pure module)" },
    ],
    summary: {
      files: g.files.length,
      hubs: g.files.filter((f) => f.isHub).length,
      skipped: g.skipped.length,
    },
  };
}

export function nextToViz(g: NextGraphResult): VizGraph {
  const nodes: VizNode[] = g.routes.map((r: NextRoute) => ({
    id: r.filePath,
    label: r.route === "/" ? "/ (root)" : r.route,
    group: r.type === "api" ? "api" : r.isClientComponent ? "client" : r.type,
    size: r.type === "layout" ? 6 : 4,
    meta: {
      route: r.route,
      filePath: r.filePath,
      type: r.type,
      isClientComponent: r.isClientComponent,
    },
  }));

  // Edges: link each route to its closest ancestor layout (App Router) or skip (Pages Router).
  const links: VizLink[] = [];
  if (g.routerType === "app") {
    const layouts = g.routes
      .filter((r) => r.type === "layout")
      .sort((a, b) => b.route.length - a.route.length); // most specific first
    for (const r of g.routes) {
      if (r.type === "layout") continue;
      const parent = layouts.find(
        (l) => r.route === l.route || r.route.startsWith(l.route === "/" ? "/" : l.route + "/")
      );
      if (parent) {
        links.push({ source: parent.filePath, target: r.filePath, kind: "wraps" });
      }
    }
  }

  return {
    nodes,
    links,
    strategy: g.strategy,
    legend: [
      { group: "page", description: "Server-rendered page" },
      { group: "client", description: "Client component (uses \"use client\")" },
      { group: "layout", description: "Layout wrapper" },
      { group: "api", description: "API route" },
      { group: "loading", description: "Loading UI" },
      { group: "error", description: "Error boundary" },
    ],
    summary: {
      routerType: g.routerType,
      routes: g.routes.length,
      warnings: g.warnings,
    },
  };
}
