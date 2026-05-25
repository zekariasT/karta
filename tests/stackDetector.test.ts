import { describe, it, expect } from "vitest";
import path from "node:path";
import { detectStack, parseMajor } from "../src/utils/stackDetector.js";

const FIXTURES = path.resolve(__dirname, "fixtures");

describe("detectStack", () => {
  it("identifies a NestJS project by @nestjs/core", () => {
    expect(detectStack(path.join(FIXTURES, "nestjs"))).toBe("nestjs");
  });

  it("identifies a Next.js project by next", () => {
    expect(detectStack(path.join(FIXTURES, "nextjs-app"))).toBe("nextjs");
    expect(detectStack(path.join(FIXTURES, "nextjs-pages"))).toBe("nextjs");
  });

  it("falls back to 'node' when no framework markers are present", () => {
    expect(detectStack(path.join(FIXTURES, "generic"))).toBe("node");
  });

  it("throws a clear error when package.json is missing", () => {
    expect(() => detectStack(path.join(FIXTURES, "does-not-exist"))).toThrow(
      /package\.json not found/
    );
  });
});

describe("parseMajor", () => {
  it.each([
    ["^14.2.1", 14],
    ["~10.0.0", 10],
    [">=11.0.0", 11],
    ["3.5.1-beta.2", 3],
    ["latest", null],
    [undefined, null],
  ])("parseMajor(%s) → %s", (input, expected) => {
    expect(parseMajor(input as string | undefined)).toBe(expected);
  });
});
