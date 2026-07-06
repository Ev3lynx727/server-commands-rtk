# OPENCODE_INTEGRATION.md — OpenCode Integration Guide

> Date: 2026-06-19
> Status: Active

---

## OVERVIEW

`commands-rtk` integrates with OpenCode as a **single-layer MCP server** that provides enhanced shell command execution with RTK token minimization, caching, and execution logging.

The legacy `rtk.ts` plugin (`~/.config/opencode/plugins/rtk.ts`) has been **disabled** — it was redundant with the MCP server layer and caused double-RTK wrapping.

---

## ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────┐
│               commands-rtk v0.2.0 (Single Layer)            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  MCP Server (commands-rtk)                            │  │
│  │  ─────────────────────────────────────────────────────────   │  │
│  │  Location: ~/server/commands-rtk/dist/index.js         │  │
│  │  Transport: stdio (local child process)                       │  │
│  │  Tools: run_process, get_cache_stats, clear_command_cache,    │  │
│  │         cached_commands, execution_log                        │  │
│  │  RTK: System hook (rtk init -g) filters at shell level       │  │
│  │  Cache: SHA256-keyed, 2s debounced disk sync                 │  │
│  │  Log: JSONL append-only execution log                         │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## MCP SERVER SETUP

### What It Does

The MCP server provides enhanced tools with:

| Tool | Description |
|------|-------------|
| `run_process` | Execute commands with RTK auto-wrapping + caching |
| `get_cache_stats` | View cache hits/misses |
| `clear_command_cache` | Reset cache |
| `cached_commands` | List cached commands |
| `execution_log` | Get recent execution log with stdout/stderr |
| `write_file` | Write file with base64-encoded content (avoids JSON serialization issues) |

### Installation

Configure in `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "mcp": {
    "commands-rtk": {
      "type": "local",
      "command": ["node", "/home/ev3lynx/server/commands-rtk/dist/index.js"],
      "enabled": true,
      "timeout": 60000
    }
  }
}
```

Enable tools for specific agents:

```jsonc
{
  "agent": {
    "builder-pro": {
      "tools": {
        "commands-rtk_run_process": true
      }
    },
    "deploy": {
      "tools": {
        "commands-rtk_run_process": true
      }
    }
  }
}
```

### Available Agents

The following agents have `commands-rtk_run_process` enabled:
- `builder-pro`
- `docker-config`
- `deploy`
- `deploy-init`
- `deploy-prod`
- `deploy-verify`
- `deploy-monitor`
- `deploy-rollback`
- `lint`

---

## CONFIGURATION FILES

| File | Purpose |
|------|---------|
| `~/.config/opencode/opencode.jsonc` | MCP server config + agent tools |
| `~/server/commands-rtk/rtk-hook.toml` | Server execution settings |

The `rtk.ts` plugin at `~/.config/opencode/plugins/rtk.ts` has been **disabled** (renamed to `rtk.ts.disabled`).

---

## RTK-HOOK.TOML SETTINGS

The MCP server reads configuration from `rtk-hook.toml`:

```toml
[execution]
timeout_ms = 60000
max_buffer_mb = 10
max_log_entries = 1000
debounce_ms = 2000
```

| Key | Default | Description |
|-----|---------|-------------|
| `timeout_ms` | 60000 | Command timeout in milliseconds |
| `max_buffer_mb` | 10 | Max output buffer per command |
| `max_log_entries` | 1000 | Max JSONL log entries kept |
| `debounce_ms` | 2000 | Cache disk write debounce interval |

Legacy sections (`[hook]`, `[rtk]`, `[commands.*]`) from v0.1.0 are **removed** — v0.2.0+ uses `rtk rewrite` for smart command dispatch via `tryRewrite()`. Per-command wrappers are no longer needed.

---

## RTK WRAPPING BEHAVIOR

All commands run through `run_process` execute raw via `/bin/sh -c`. RTK filtering is handled by the system hook (`rtk init -g`) at the shell level — add `rtk` prefix to any command for token minimization (e.g. `rtk ls -la`). See AGENTS.md → RTK Token Optimization section.

### Controlling RTK

| Parameter | Effect |
|-----------|--------|
| `model_used` | Model name metadata for execution log |
| `model_used` | Model name metadata for training logs |
| (default) | `rtk {command}` — auto-wrapped |

---

## VERIFICATION

### Check MCP Server Running

Send a JSON-RPC request to check cache stats:

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/call",
  "params": {
    "name": "get_cache_stats",
    "arguments": {}
  }
}
```

Expected response:

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\n  \"hits\": 10,\n  \"misses\": 208\n}"
      }
    ]
  }
}
```

---

## TROUBLESHOOTING

### MCP Server Not Working

1. Check config is valid JSONC:
   ```bash
   cat ~/.config/opencode/opencode.jsonc | head -20
   ```

2. Check server path exists:
   ```bash
   ls -la ~/server/commands-rtk/dist/index.js
   ```

3. Run server directly to check for errors:
   ```bash
   node ~/server/commands-rtk/dist/index.js --help
   ```

4. Run the test suite:
   ```bash
   cd ~/server/commands-rtk && npx tsx suite-test.ts
   ```

### Cache Issues

Clear the cache and restart:
```bash
rm ~/.local/share/state/commands-rtk/command-cache.json
```

The cache file is auto-recreated on the next command. Corruption is handled gracefully — the server logs a warning and starts fresh.

---

## BUILD & VERIFY

```bash
# Type check
npx tsc --noEmit

# Build
npm run build

# Run test suite (33 tests: unit, integration, stress, benchmark, resilience)
npx tsx suite-test.ts

# Quick smoke test (unit only)
npx tsx suite-test.ts --quick
```

Pre-commit hooks are configured in `.pre-commit-config.yaml`:
```bash
git init && pre-commit install
```

---

## SUMMARY

The server provides:

1. **RTK auto-wrapping** — All commands get token minimization
2. **Caching** — SHA256-keyed with debounced disk sync (~250x speedup on repeated commands)
3. **Execution logging** — JSONL append log for monitoring and training data
4. **Configurability** — Timeout, buffer, log size, and debounce via `rtk-hook.toml`
5. **Safe file writes** — `write_file` with base64-encoded content avoids JSON serialization failures (see `docs/references/000_user_experiences.md`)

---

*Last Updated: 2026-06-20*
*Documentation: commands-rtk v0.2.0*
