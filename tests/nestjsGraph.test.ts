import { describe, it, expect } from "vitest";
import path from "node:path";
import { buildNestjsGraph } from "../src/graphs/nestjsGraph.js";

const FIXTURE = path.resolve(__dirname, "fixtures/nestjs");

describe("buildNestjsGraph", () => {
  it("returns the nestjs-module-graph strategy", async () => {
    const g = await buildNestjsGraph(FIXTURE);
    expect(g.strategy).toBe("nestjs-module-graph");
  });

  it("finds all three @Module classes", async () => {
    const g = await buildNestjsGraph(FIXTURE);
    expect(g.modules.map((m) => m.name).sort()).toEqual([
      "AppModule",
      "FeatureModule",
      "SharedModule",
    ]);
  });

  it("AppModule is a leaf (nothing imports it)", async () => {
    const g = await buildNestjsGraph(FIXTURE);
    const app = g.modules.find((m) => m.name === "AppModule")!;
    expect(app.isShared).toBe(false);
    expect(app.imports.sort()).toEqual(["FeatureModule", "SharedModule"]);
  });

  it("SharedModule is shared (imported by AppModule and FeatureModule)", async () => {
    const g = await buildNestjsGraph(FIXTURE);
    const shared = g.modules.find((m) => m.name === "SharedModule")!;
    expect(shared.isShared).toBe(true);
    expect(shared.providers).toContain("SharedService");
    expect(shared.exports).toContain("SharedService");
  });

  it("flattens provider object literals", async () => {
    const g = await buildNestjsGraph(FIXTURE);
    const feature = g.modules.find((m) => m.name === "FeatureModule")!;
    const providerObj = feature.providers.find((p) => p.startsWith("{"));
    expect(providerObj).toBeDefined();
    expect(providerObj).toBe('{ provide: "TOKEN", useClass: FeatureService }');
    expect(providerObj).not.toMatch(/\n/);
  });

  it("reports no circular risks on a clean DAG", async () => {
    const g = await buildNestjsGraph(FIXTURE);
    expect(g.circularRisks).toEqual([]);
  });

  it("records relative file paths only", async () => {
    const g = await buildNestjsGraph(FIXTURE);
    for (const m of g.modules) {
      expect(m.filePath).not.toMatch(/^\//);
      expect(m.filePath).toMatch(/^src\//);
    }
  });
});
