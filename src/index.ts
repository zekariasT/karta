#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import * as readProjectStructure from "./tools/readProjectStructure.js";
import * as getTechStack from "./tools/getTechStack.js";
import * as findRelevantFiles from "./tools/findRelevantFiles.js";
import * as getModuleSummary from "./tools/getModuleSummary.js";
import * as getArchitectureGraph from "./tools/getArchitectureGraph.js";

const TOOLS = [
  readProjectStructure,
  getTechStack,
  findRelevantFiles,
  getModuleSummary,
  getArchitectureGraph,
];

async function main() {
  const server = new McpServer({
    name: "karta",
    version: "0.1.0",
  });

  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        inputSchema: t.inputSchema as never,
      },
      t.handler as never
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Diagnostics go to stderr — stdout is reserved for the MCP protocol.
  console.error(`[karta] MCP server ready (${TOOLS.length} tools)`);
}

main().catch((err) => {
  console.error("[karta] fatal:", err);
  process.exit(1);
});
