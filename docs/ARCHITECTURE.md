# Architecture

## What it does

commands-rtk is an MCP server that executes shell commands, wraps output with RTK for ~90% token reduction, caches results across sessions, and logs all executions. It's designed as a local stdio server for AI agents.

## Components

```
src/
├── index.ts        — entry point, stdio transport, McpServer setup
├── server.ts       — tool/resource/prompt registrations
├── schemas.ts      — Zod schemas for all tool parameters
├── executor.ts     — spawn() wrapper, RTK prefix, AbortController timeout
├── cache.ts        — persistent SHA-256 keyed command cache
├── logger.ts       — append-only JSONL execution log with rotation
├── config.ts       — rtk-hook.toml parser + env var merge
├── errors.ts       — error categorization (3 types)
└── resolver.ts     — MCP_RESOURCE_ROOTS / TOML URI resolver
```

9 source files. Under 30 — the lean threshold.

## Data Flow

```
MCP Client → stdin JSON-RPC
  → server.ts routes by method name
    → schemas.ts Zod .parse() validates params
      → executor.ts: spawn("/bin/sh", ["-c", "rtk " + cmd])
        → rtk CLI filters output in real-time
        → stdout/stderr pipe collection
        → cache.ts upsert(result)
        → logger.ts append(entry)
  ← JSON-RPC response on stdout
```

## Key Constraints

- Stdio-only transport. No HTTP/SSE. Single client per process.
- Node 24+ (ESM). No transpile step beyond tsc.
- RTK CLI required on PATH. Auto-prefixes via executor.ts.
- Shell builtins (`cd`, `exit`, `&`, `&&`, `|`) bypass RTK prefix.
