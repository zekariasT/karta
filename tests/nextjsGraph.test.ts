import { describe, it, expect } from "vitest";
import path from "node:path";
import { buildNextjsGraph } from "../src/graphs/nextjsGraph.js";

const APP = path.resolve(__dirname, "fixtures/nextjs-app");
const PAGES = path.resolve(__dirname, "fixtures/nextjs-pages");

describe("buildNextjsGraph — App Router", () => {
  it("identifies routerType=app", async () => {
    const g = await buildNextjsGraph(APP);
    expect(g.strategy).toBe("nextjs-route-map");
    expect(g.routerType).toBe("app");
  });

  it("maps page.tsx and layout.tsx into routes", async () => {
    const g = await buildNextjsGraph(APP);
    const byRoute = g.routes.reduce<Record<string, string[]>>((acc, r) => {
      (acc[r.route] ??= []).push(r.type);
      return acc;
    }, {});
    expect(byRoute["/"]?.sort()).toEqual(["layout", "page"]);
    expect(byRoute["/dashboard"]?.sort()).toEqual(["layout", "page"]);
  });

  it("strips route groups from the URL", async () => {
    const g = await buildNextjsGraph(APP);
    // app/(marketing)/about/page.tsx → /about
    const about = g.routes.find((r) => r.route === "/about");
    expect(about).toBeDefined();
    expect(about!.filePath).toBe("app/(marketing)/about/page.tsx");
  });

  it("detects the \"use client\" directive", async () => {
    const g = await buildNextjsGraph(APP);
    const dashPage = g.routes.find(
      (r) => r.route === "/dashboard" && r.type === "page"
    )!;
    expect(dashPage.isClientComponent).toBe(true);
    const home = g.routes.find((r) => r.route === "/" && r.type === "page")!;
    expect(home.isClientComponent).toBe(false);
  });
});

describe("buildNextjsGraph — Pages Router", () => {
  it("identifies routerType=pages", async () => {
    const g = await buildNextjsGraph(PAGES);
    expect(g.routerType).toBe("pages");
  });

  it("collapses index.tsx to its parent route", async () => {
    const g = await buildNextjsGraph(PAGES);
    expect(g.routes.find((r) => r.route === "/")).toBeDefined();
  });

  it("marks /api/* files as type=api", async () => {
    const g = await buildNextjsGraph(PAGES);
    const health = g.routes.find((r) => r.filePath.endsWith("api/health.ts"))!;
    expect(health.type).toBe("api");
    expect(health.route).toBe("/api/health");
  });

  it("excludes _app, _document, _error", async () => {
    const g = await buildNextjsGraph(PAGES);
    expect(g.routes.find((r) => r.filePath.includes("_app"))).toBeUndefined();
  });

  it("never marks pages-router routes as client components", async () => {
    const g = await buildNextjsGraph(PAGES);
    for (const r of g.routes) {
      expect(r.isClientComponent).toBe(false);
    }
  });
});
