#!/usr/bin/env node
import { ServerCommandsRTK } from "./server.js";

function printHelp(): void {
  const help = [
    "Commands-RTK v0.3.0 — MCP Server with command caching and file ops",
    "",
    "Usage:",
    "  node dist/index.js              Run MCP server",
    "  node dist/index.js --help       Show this help",
    "  node dist/index.js --stats      Show cache statistics",
    "  node dist/index.js setup        Apply one-time patches (rtk fix, etc.)",
    "",
    "MCP Tools:",
    "  run_process          - Run shell command with caching and logging",
    "  get_cache_stats      - Get cache hits/misses",
    "  clear_command_cache  - Clear all cached commands",
    "  cached_commands      - List all cached commands",
    "  execution_log        - Get execution log (last N entries, with --include_archives flag)",
    "  list_archives        - List rotated log archives for dataset pipeline",
    "  write_file           - Write file with base64 content (avoids JSON parse issues)",
    "  resolve_uri          - Resolve scheme:// URI to absolute file path",
    "",
    "Environment:",
    "  SERVER_DIR        - Path to server directory (default: parent of dist/)",
    "  RTK_MODEL_USED    - Model name override (default: auto-detected from client)",
    "  MCP_RESOURCE_ROOTS - JSON scheme-to-dir map (fallback, TOML config is primary)",
  ].join("\n");
  console.log("\n" + help + "\n");
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (process.argv.includes("setup")) {
  const { execFileSync } = await import("node:child_process");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const selfDir = dirname(fileURLToPath(import.meta.url));
  const script = resolve(selfDir, "..", "patches", "apply-rtk-patch.sh");
  try {
    execFileSync("bash", [script], { stdio: "inherit" });
  } catch {
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes("--stats")) {
  const { readFileSync, existsSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { homedir } = await import("node:os");
  const cacheFile = resolve(homedir(), ".local/share/state/commands-rtk/command-cache.json");
  if (existsSync(cacheFile)) {
    try {
      const data = JSON.parse(readFileSync(cacheFile, "utf8"));
      console.log("Cache Statistics:");
      console.log("  Hits:", data.stats?.hits ?? 0);
      console.log("  Misses:", data.stats?.misses ?? 0);
      console.log(
        "  Cached commands:",
        Object.keys(data.cache ?? {}).length,
      );
    } catch {
      console.log("No cache found.");
    }
  } else {
    console.log("No cache found.");
  }
  process.exit(0);
}

const server = new ServerCommandsRTK();

process.on("SIGTERM", () => {
  server.flush();
  process.exit(0);
});

process.on("SIGINT", () => {
  server.flush();
  process.exit(0);
});

server.start();
