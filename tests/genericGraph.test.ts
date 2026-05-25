import { describe, it, expect } from "vitest";
import path from "node:path";
import { buildGenericGraph } from "../src/graphs/genericGraph.js";

const FIXTURE = path.resolve(__dirname, "fixtures/generic");

describe("buildGenericGraph", () => {
  it("returns the file-import-graph strategy", async () => {
    const g = await buildGenericGraph(FIXTURE);
    expect(g.strategy).toBe("file-import-graph");
  });

  it("finds all source files under src/", async () => {
    const g = await buildGenericGraph(FIXTURE);
    const paths = g.files.map((f) => f.filePath).sort();
    expect(paths).toEqual([
      "src/index.ts",
      "src/logger.ts",
      "src/service.ts",
      "src/util.ts",
    ]);
  });

  it("marks util.ts as a hub (imported by 3 files)", async () => {
    const g = await buildGenericGraph(FIXTURE);
    const util = g.files.find((f) => f.filePath === "src/util.ts");
    expect(util).toBeDefined();
    expect(util!.isHub).toBe(true);
    expect(util!.importedBy.sort()).toEqual([
      "src/index.ts",
      "src/logger.ts",
      "src/service.ts",
    ]);
  });

  it("records local imports only (no external packages)", async () => {
    const g = await buildGenericGraph(FIXTURE);
    const service = g.files.find((f) => f.filePath === "src/service.ts");
    expect(service!.imports.sort()).toEqual(["src/logger.ts", "src/util.ts"]);
  });

  it("does not mark leaf entry-point files as hubs", async () => {
    const g = await buildGenericGraph(FIXTURE);
    const index = g.files.find((f) => f.filePath === "src/index.ts");
    expect(index!.isHub).toBe(false);
  });
});
