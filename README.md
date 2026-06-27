# server-commands-rtk

MCP server for shell command execution with RTK auto-filtering (~90% token reduction), persistent caching, streaming spawn executor with timeout, and full execution logging for training data.

## Architecture

```
MCP Client → run_process → RTK preprocessor → spawn("/bin/sh", ["-c", cmd])
                            ↓
                     AbortController (timeout)
                            ↓
                   collectStream (stdout/stderr)
                            ↓
                     Cache (.command-cache.json)
                            ↓
                     Logger (.execution-log.jsonl)
```

The executor uses `spawn` (not `exec`) — streaming output with no `maxBuffer` ceiling. Timeout uses `AbortController` to cancel stream collection immediately, then `SIGKILL` to terminate the process tree.

## Installation

```bash
# Install RTK first
curl -LsSf https://ev3lynx.github.io/rtk/install.sh | sh

# Build
cd server-commands-rtk
npm install
npm run build
```

Add to OpenCode config:

```json
{
  "mcp": {
    "server-commands-rtk": {
      "type": "local",
      "command": ["node", "/path/to/server-commands-rtk/dist/index.js"],
      "enabled": true,
      "timeout": 60000
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `run_process` | Execute shell command with RTK auto-filtering |
| `get_cache_stats` | View cache hits/misses and size |
| `clear_command_cache` | Clear all cached commands |
| `cached_commands` | List all cached commands with keys |
| `execution_log` | Get execution log with optional archive history |
| `list_archives` | List rotated log archive files for dataset pipeline |
| `write_file` | Write file with base64 content (bypasses JSON serialization issues) |

## Usage

### run_process

```javascript
// Auto-RTK (default) — ~90% token reduction
run_process({command: "ls -la"})

// Raw output, no filtering
run_process({command: "ls -la", use_raw: true})

// Explicit RTK control
run_process({command: "ls -la", use_rtk_filter: true})

// With timeout override (ms)
run_process({command: "sleep 30", timeout_ms: 5000})

// With working directory and description
run_process({
  command: "npm test",
  cwd: "/path/to/project",
  description: "run unit tests",
  timeout_ms: 30000
})

// Clear cache for a specific command
run_process({command: "npm install", clear_cache: true})
```

### execution_log

```javascript
// Last 100 entries
execution_log({limit: 100})

// Include rotated archives for full history
execution_log({limit: 500, include_archives: true})
```

### write_file

Use instead of `write`/`filesystem_write_file` when content contains quotes, backticks, or special characters that break JSON serialization:

```javascript
write_file({
  path: "/tmp/output.txt",
  content_b64: "SGVsbG8gV29ybGQ="   // base64-encoded content
})
```

## Configuration (rtk-hook.toml)

```toml
[execution]
timeout_ms = 60000         # Default command timeout
max_buffer_mb = 10         # Max output buffer per command
max_log_entries = 1000     # Max in-memory log entries
max_archives = 50          # Max rotated archive files
compress_archives = true   # Gzip rotated archives

[cache]
debounce_ms = 2000         # Debounce window for identical commands

[hook]
auto_wrap = true

exclude = ["curl", "wget", "ssh", "scp"]

[rtk]
ultra_compact = false
```

## Cache

- `.command-cache.json` — persistent JSON cache across sessions
- Cache key = hash of (command + cwd)
- Hit/miss tracking via `get_cache_stats`

## Execution Log

- `.execution-log.jsonl` — append-only JSONL with full stdout/stderr
- Auto-rotation when `max_log_entries` exceeded
- Compressed archives (`.jsonl.gz`) in `.execution-log.archives/`
- Includes per-entry metadata: exit code, duration, model used, error category, RTK filter status, line counts

## Response Format

All tools return JSON with structure:

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
  "rtk_filtered": true
}
```

Error types: `timeout`, `not_found`, `permission_error`, `memory_error`, `unknown_error`.

Timeout returns `exitCode: 124` and stderr message.

## Token Savings Example

| Command | Raw Tokens | RTK Tokens | Savings |
|---------|-----------|------------|---------|
| `ls -la` | ~25,000 | ~3,000 | **88%** |
| `tree` | ~50,000 | ~5,000 | **90%** |
| `git diff` | ~15,000 | ~500 | **97%** |
| `npm install` | ~5,000 | ~200 | **96%** |

Typical session: 58% budget → ~5-10% with RTK.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SERVER_DIR` | Custom server root directory |
| `RTK_MODEL_USED` | Model name override for execution metadata |
| `MCP_RESOURCE_ROOTS` | JSON map of scheme→dir for resource templates |
| `LOG_LEVEL` | Log level (error, warn, info, debug) |

## License

MIT
