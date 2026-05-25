#!/usr/bin/env node
import path from "node:path";
import { startViewer } from "./server.js";

function parseArgs(argv: string[]): { projectPath: string; port: number } {
  let projectPath: string | null = null;
  let port = 3737;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project" || a === "-p") {
      projectPath = argv[++i];
    } else if (a === "--port") {
      port = parseInt(argv[++i], 10);
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (!a.startsWith("-") && !projectPath) {
      projectPath = a;
    }
  }
  if (!projectPath) {
    projectPath = process.cwd();
  }
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    console.error(`Invalid --port: ${port}`);
    process.exit(2);
  }
  return { projectPath: path.resolve(projectPath), port };
}

function printHelp() {
  console.log(`karta-viewer — interactive 3D architecture graph

Usage:
  karta-viewer [--project <path>] [--port <port>]
  karta-viewer <path>

Options:
  --project, -p   Path to the project to visualize (default: current directory)
  --port          Port to bind to (default: 3737)
  --help, -h      Show this help

Then open http://localhost:<port> in a browser.`);
}

async function main() {
  const { projectPath, port } = parseArgs(process.argv.slice(2));
  try {
    await startViewer({ projectPath, port });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("EADDRINUSE")) {
      console.error(`Port ${port} is already in use. Pass --port <other> to pick a different port.`);
    } else {
      console.error("karta-viewer failed:", msg);
    }
    process.exit(1);
  }
}

main();
