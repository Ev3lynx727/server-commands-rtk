# commands-rtk

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/Ev3lynx727/commands-rtk/actions/workflows/ci.yml/badge.svg)](https://github.com/Ev3lynx727/commands-rtk/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/commands-rtk)](https://www.npmjs.com/package/commands-rtk)

MCP server that executes shell commands via MCP tools - with streaming spawn, automatic [RTK](https://github.com/rtk-ai/rtk) token reduction, persistent caching, and full execution logging.

- **Streaming spawn** - uses `spawn` (not `exec`), no `maxBuffer` ceiling, pipes stdout/stderr directly
- **Auto-RTK** - transparently wraps commands with RTK for ~90% token reduction
- **Timeout + cancellation** - `AbortController` cancels stream collection immediately, `SIGKILL` terminates process tree
- **Persistent cache** - results cached in `~/.local/share/state/commands-rtk/command-cache.json` across sessions
- **Execution logger** - append-only JSONL with auto-rotation, gzip compression, archive listing
- **Safe file writes** - `write_file` with base64 content avoids JSON serialization breakage on special characters
- **URI resolver** - `resolve_uri` resolves `scheme://path` to absolute file paths via shared TOML config

## Includes

- ✅ **License** - This repository contains a LICENSE file
- ✅ **Prompts** - This MCP Server includes prompts users can invoke
- ✅ **Resources** - This MCP Server includes resources for attaching and managing context data

---

## Requirements

- **Node.js 24+** (ESM, `"type": "module"` in package.json)
- **rtk CLI** - install via `curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | sh`

## Installation

### npm

```bash
npm install -g @ev3lynx/commands-rtk
```

### From source

```bash
git clone https://github.com/Ev3lynx727/mcp-commands-rtk.git
cd mcp-commands-rtk
npm install
npm run build
```

### OpenCode / MCP client config

Add to OpenCode:

```json
{
  "mcp": {
    "commands-rtk": {
      "type": "local",
      "command": ["node", "/path/to/commands-rtk/dist/index.js"],
      "enabled": true,
      "timeout": 60000
    }
  }
}
```

For MCP clients (Claude Desktop, Cursor, VSCode, etc):

```json
{
  "mcpServers": {
    "commands-rtk": {
      "command": "node",
      "args": ["/path/to/commands-rtk/dist/index.js"],
      "env": {}
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `run_process` | Execute a shell command with RTK auto-filtering |
| `get_cache_stats` | Show cache hit/miss counts and entry count |
| `clear_command_cache` | Wipe all cached command results |
| `cached_commands` | List all cached command keys and timestamps |
| `execution_log` | Read execution log entries, optionally from archives |
| `list_archives` | List rotated `.jsonl.gz` archive files |
| `write_file` | Write a file from base64 content (safe for special characters) |
| `resolve_uri` | Resolve `scheme://path` to absolute file path via TOML config or `MCP_RESOURCE_ROOTS` |

## Schema

How commands-rtk processes an MCP tool call:

```
                          commands-rtk MCP Server
  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  │  MCP Client              commands-rtk                    │
  │  (OpenCode,               MCP Server                     │
  │   Claude,      ────────  ┌──────────┐                   │
  │   Cursor)      JSON-RPC  │ server.ts │                  │
  │      │          stdin     │           │                  │
  │      │  tools/call        │  Zod      │                  │
  │      │  run_process ─────→│  .parse() │                  │
  │      │  "ls -la"          └────┬──────┘                  │
  │      │                         │                         │
  │      │                         ▼                         │
  │      │                  ┌──────────────┐                │
  │      │                  │ executor.ts  │                │
  │      │                  │              │                │
  │      │                  │  spawn(      │                │
  │      │                  │   "/bin/sh", │                │
  │      │                  │   ["rtk ls   │──→ rtk CLI     │
  │      │                  │    -la"])    │    filters     │
  │      │                  │              │    output      │
  │      │                  └──────┬───────┘                │
  │      │                         │                         │
  │      │                         ├── cache.ts ── upsert    │
  │      │                         ├── logger.ts ── append   │
  │      │                         ▼                         │
  │      │  JSON-RPC         ┌──────────┐                   │
  │      │  response ←───────│ server.ts│                   │
  │      │  stdout           │  return   │                  │
  │      │                   └──────────┘                   │
  │                                                          │
  │  State: ~/.local/share/state/commands-rtk/               │
  │  ├── command-cache.json   (SHA-256 keyed)               │
  │  └── execution-log.jsonl  (append-only, rolls)           │
  │                                                          │
  └──────────────────────────────────────────────────────────┘
```

The dotted flow: `server.ts` receives `tools/call` → `Zod.parse()` validates → `executor.ts` spawns with `rtk` prefix → result cached + logged → JSON-RPC response returned.

## Usage

```javascript
// Auto-RTK (default) - ~90% token reduction
run_process({command: "ls -la"})

// Bypass RTK filtering entirely
run_process({command: "ls -la"})

// Explicitly enable/disable RTK
run_process({command: "ls -la"})

// Override default timeout (60s) per call
run_process({command: "sleep 30", timeout_ms: 5000})

// Set working directory and attach metadata
run_process({
  command: "npm test",
  cwd: "/path/to/project",
  description: "run unit tests",
  model_used: "claude-sonnet-4",
  timeout_ms: 30000
})

// Force cache bypass
run_process({command: "npm install", clear_cache: true})
```

### execution_log

```javascript
// Tail last 100 entries
execution_log({limit: 100})

// Include rotated archives for full history
execution_log({limit: 500, include_archives: true})
```

### write_file

MCP tool parameters are JSON-serialized. Content with quotes, backticks, or long special-character strings can break the JSON framing. Use `write_file` with base64 encoding:

```javascript
write_file({
  path: "/tmp/output.txt",
  content_b64: "SGVsbG8gV29ybGQ="
})
```

### resolve_uri

```javascript
resolve_uri({uri: "headquarters://."})
// { scheme: "headquarters", relativePath: ".", absolutePath: "/home/ev3lynx/headquarters" }

resolve_uri({uri: "datasets://train/run-001.parquet"})
// { scheme: "datasets", relativePath: "train/run-001.parquet", absolutePath: "/home/ev3lynx/datasets/memory-graph/train/run-001.parquet" }
```

Schemes are loaded from `~/.config/uri-resolver/config.toml` (primary) with `MCP_RESOURCE_ROOTS` as fallback. `scheme://.` resolves to the base directory.

### list_archives

```javascript
list_archives()
// Returns: { archives: ["file1.jsonl.gz", ...], count: 7 }
```

## Configuration (rtk-hook.toml)

| Section | Key | Default | Description |
|---------|-----|---------|-------------|
| `[execution]` | `timeout_ms` | `60000` | Default per-command timeout (overridable per call) |
| `[execution]` | `max_buffer_mb` | `10` | Max stdout/stderr collected per command |
| `[execution]` | `max_log_entries` | `1000` | Entries kept in active log before rotation |
| `[execution]` | `max_archives` | `50` | Max rotated archive files retained |
| `[execution]` | `compress_archives` | `true` | Compress rotated logs with gzip |
| `[cache]` | `debounce_ms` | `2000` | Window for deduplicating identical commands |

Example:

```toml
[execution]
timeout_ms = 60000
max_buffer_mb = 10
max_log_entries = 1000
max_archives = 50
compress_archives = true

[cache]
debounce_ms = 2000
```

## State Files

All runtime state lives under `~/.local/share/state/commands-rtk/`:

```
~/.local/share/state/commands-rtk/
├── command-cache.json      # Persistent command cache
└── execution-log.jsonl     # Append-only execution log
```

Created automatically on first run (`mkdirSync` with `recursive: true`).

### Cache

- **File**: `command-cache.json` - persistent JSON, survives server restart
- **Key**: SHA-256 hash of `(command + cwd)`
- **Stats**: Hit/miss counters via `get_cache_stats`
- **Flush**: Written to disk on every mutation + on SIGTERM/SIGINT

### Execution Log

- **File**: `execution-log.jsonl` - append-only, one JSON object per line
- **Rotation**: When `max_log_entries` reached, half of entries archived. Rotated files land alongside the active log as `execution-log-{timestamp}.jsonl.gz`
- **Per-entry metadata**: `timestamp`, `key`, `command`, `rtk_filtered`, `rtk_rewritten`, `cached`, `success`, `exitCode`, `duration_ms`, `error_type`, `stdout`/`stderr`, `stdout_lines`/`stderr_lines`, `model_used`

## MCP Resources & URI Resolution

Resource templates and URI resolution share a unified scheme registry loaded from two sources (TOML wins):

1. **Primary**: `~/.config/uri-resolver/config.toml` — shared with the standalone uri-resolver MCP server
2. **Fallback**: `MCP_RESOURCE_ROOTS` env var — for deployment-specific overrides

```bash
export MCP_RESOURCE_ROOTS='{"headquarters": "~/headquarters"}'
```

Each scheme registers a resource template `{scheme}://{path}` and is queryable via the `resolve_uri` tool. Path traversal is denied via `startsWith()` guard.

## Response Format

All tools return JSON:

```json
{
  "cached": false,
  "key": "sha256-hash",
  "command": "echo hello",
  "result": {
    "success": true,
    "stdout": "hello\n",
    "stderr": "",
    "exitCode": 0,
    "duration_ms": 12,
    "error_type": null
  },
  "rtk_filtered": true,
  "rtk_rewritten": true
}
```

Error types: `timeout`, `not_found` (ENOENT), `permission_error` (EACCES/EPERM), `memory_error` (ENOMEM), `unknown_error`.

Timeout returns `exitCode: 124` with message in `stderr`.

## Token Savings

| Command | Raw Tokens | RTK Tokens | Savings |
|---------|-----------|------------|---------|
| `ls -la` | ~25,000 | ~3,000 | **88%** |
| `tree` | ~50,000 | ~5,000 | **90%** |
| `git diff` | ~15,000 | ~500 | **97%** |
| `npm install` | ~5,000 | ~200 | **96%** |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SERVER_DIR` | No | Custom server root (defaults to directory containing `dist/`) |
| `RTK_MODEL_USED` | No | Override for `model_used` in execution log metadata |
| `MCP_RESOURCE_ROOTS` | No | JSON object mapping scheme names to directory paths (fallback, TOML config is primary) |
| `LOG_LEVEL` | No | Log level (`error`, `warn`, `info`, `debug`) |

## Credit

This project would not work without [RTK](https://github.com/rtk-ai/rtk) — the Rust token reducer that filters shell command output for ~90% token savings.

## License

MIT
