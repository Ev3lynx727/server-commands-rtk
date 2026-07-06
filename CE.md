# CE.md — commands-rtk

## Identity

MCP server for shell command execution with RTK token minimization, persistent caching, and execution logging. TypeScript + ESM + Zod, v0.3.0.

Provides 7 tools + 1 write utility, plus configurable resource roots for agent document access and `scheme://` URI resolution via shared TOML config.

## Architecture

```
Agent (OpenCode) <--stdio MCP--> commands-rtk (this server)
                                     |
                    +----------------+----------------+
                    |                |                |
               run_process      write_file     resource roots
                    |                |          + resolve_uri
              /bin/sh -c       base64 decode      |
              +-- spawn()      +-- Buffer.from   file read
              +-- AbortCtrl    +-- mkdir -p      +-- path guard
              +-- collect      +-- writeFile     +-- TOML config
                    |                             +-- MCP_RESOURCE_ROOTS fallback
        +-----------+-----------+
        |           |           |
    command-cache   rtk     execution-log
   (sha256 JSON)  prefix     (append JSONL)

State files: ~/.local/share/state/commands-rtk/
```

### Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Process model | spawn, not exec | No maxBuffer ceiling, proper abort/cancel via AbortController |
| Termination | SIGKILL on timeout | Hard kill guarantees process tree dies |
| Cache key | SHA-256 (cmd + cwd) | Deterministic, collision-free, 16-char hex |
| Cache persist | Debounced JSON write | 2s batch window, survives server restart |
| Log format | Append JSONL + gzip | Training-data ready, auto-rotate at 1K entries |
| RTK wrapping | Uniform prefix on all cmds | v0.2.0 removed per-command wrapper config (legacy v0.1.0) |
| Error category | Pattern match on stderr/stdout | 7 categories for agent decision-making |
| File writes | Base64-encoded content | Bypass MCP JSON serialization breakage on quotes/backticks |
| Resource roots | TOML config ~/.config/uri-resolver/config.toml + MCP_RESOURCE_ROOTS fallback | Shared scheme config with standalone uri-resolver MCP server |
| URI resolution | In-process resolveUri() | Pure sync mapping, no I/O, no cache overhead |

## Key Files

| Path | Role |
|------|------|
| `src/index.ts` | Entry point, --help/--stats flags, SIGTERM flush handler |
| `src/server.ts` | MCP server hub: 8 tool handlers + resource root setup + TOML config loader |
| `src/resolver.ts` | URI resolution: SchemeEntry, resolveUri(), listSchemes() — forked from uri-resolver |
| `src/schemas.ts` | All Zod schemas: RunProcessArgs, ResolveUriArgs, CacheEntry, ExecResult, WriteFileArgs, ErrorCategory, etc. |
| `src/executor.ts` | Shell spawn engine: spawn, stream collect, timeout, sigkill |
| `src/cache.ts` | SHA-256 hashed command cache with 2s debounced JSON persistence |
| `src/logger.ts` | Append-only JSONL execution log: auto-rotate, gzip archive, archive listing |
| `src/config.ts` | TOML loader via smol-toml: execution config + log config |
| `src/rtk.ts` | RTK rewrite integration: tryRewrite() — calls `rtk rewrite` subprocess for smart command dispatch |
| `src/errors.ts` | Error categorizer: 7 patterns matched against stderr+stdout |
| `rtk-hook.toml` | Config: timeout, buffer, debounce |
| `~/.local/share/state/commands-rtk/command-cache.json` | Persistent cache file (auto-created) |
| `~/.local/share/state/commands-rtk/execution-log.jsonl` | Append-only execution log (auto-created) |
| `~/.config/uri-resolver/config.toml` | Shared scheme config (read on startup, optional) |
| `docs/OPENCODE_INTEGRATION.md` | OpenCode setup guide, agent permissions, troubleshooting |
| `docs/BENCHMARK.md` | Latency, token savings, cache performance benchmarks |
| `docs/references/` | User experience docs (000-003) |
| `suite-test.ts` | 33-test suite (unit, integration, stress, benchmark, resilience) |

## Key Types (from schemas.ts)

```typescript
// Tool input schemas
interface RunProcessArgs { command: string; cwd?: string; clear_cache?: boolean; use_rtk_filter?: boolean; use_raw?: boolean; model_used?: string; timeout_ms?: number; }
interface WriteFileArgs { path: string; content_b64: string; }
interface ExecutionLogArgs { limit: number; include_archives: boolean; }
interface ResolveUriArgs { uri: string; }

// Core types
interface ExecResult { success: boolean; stdout: string; stderr: string; exitCode: number; duration_ms: number; error_type: ErrorCategory | null; }
interface CacheEntry { result: ExecResult; timestamp: number; command: string; raw_command: string; rtk_filtered: boolean; rtk_rewritten: boolean; model_used: string; }
interface ExecutionLogEntry extends CacheEntry { key: string; cached: boolean; stdout_lines: number; stderr_lines: number; }
type ErrorCategory = "permission_error" | "not_found" | "timeout" | "syntax_error" | "network_error" | "memory_error" | "unknown_error";

// Server config (from rtk-hook.toml)
interface ServerConfig { timeout_ms: number; max_buffer_mb: number; max_log_entries: number; debounce_ms: number; max_active_entries: number; max_archives: number; compress_archives: boolean; }
```

## Pipeline Flow (run_process)

```
Agent call -> handleRunProcess(args)
  |-> Zod parse & validate RunProcessArgs
  |-> Resolve model_used (arg > env > client name > "unknown")
  |-> tryRewrite() -> calls `rtk rewrite <cmd>` for smart dispatch (falls back to raw if rtk unavailable)
  |-> hash(command + cwd) -> SHA-256 16-char hex key
  |-> cache lookup (hit? -> return cached + recordHit)
  |-> executeCommand(spawn, timeout, buffer limit)
  |-> cache.set(key, result) -> debounced JSON write
  |-> logger.append(entry) -> JSONL append
  |-> return ExecResult with metadata
```

### Error Categories

| Category | Trigger | Exit Code |
|----------|---------|-----------|
| timeout | AbortController fires | 124 |
| not_found | ENOENT in spawn | 1 |
| permission_error | EACCES/EPERM | 1 |
| memory_error | ENOMEM | 1 |
| syntax_error | stderr/stdout match | varies |
| network_error | stderr/stdout match | varies |
| unknown_error | fallback | varies |

## Constraints

- **Node.js 24+ required** (ESM, `"type": "module"`)
- **rtk CLI must be installed** separately: `curl -LsSf https://ev3lynx.github.io/rtk/install.sh`
- **Stdio transport only** (no network exposure, no auth, local-only)
- **Best-effort disk writes** — never crashes on I/O errors (silent try/catch on cache/log writes)
- **Single-process, single-user** — no concurrent access safety on cache/log files
- **Config cascade**: CLI arg > env var > toml config > hard defaults
- **State dir** — `~/.local/share/state/commands-rtk/` created on first run (`mkdirSync recursive`)
- **Cache is in-memory first** — loaded from `command-cache.json` on startup, debounced writes
- **Path traversal protection** on resource roots via startsWith() check

## Integration

- Registered as local MCP server in `~/.config/opencode/opencode.jsonc`
- 9 agents have `commands-rtk_run_process` enabled (builder-pro, deploy, deploy-*, docker-config, lint)
- Execution log is a source for skeleton-cli datasets (category: execution-logs)
- Legacy `rtk.ts` plugin disabled (renamed to `rtk.ts.disabled`) — replaced by server-side RTK wrapping
- Training export: `model_used` field segments execution log by agent/model for dataset building

## Pre-commit & CI

| Hook | Command | Trigger | Scope |
|------|---------|---------|-------|
| `tsc` | `npx tsc --noEmit` | pre-commit | All `.ts` files |
| `build` | `npm run build` | pre-commit | Files under `src/` |

Both are local hooks (no remote repo). Install via `pip install pre-commit && pre-commit install`. Run manually: `pre-commit run --all-files`.

## Entry Point Details (`src/index.ts`)

| Flag | Behavior |
|------|----------|
| `--help` / `-h` | Print tool list + env var reference, exit 0 |
| `--stats` | Read `~/.local/share/state/commands-rtk/command-cache.json`, print hit/miss counts + command count, exit 0 |

Signal handling: `SIGTERM` and `SIGINT` both call `server.flush()` (writing cache to disk) before `process.exit(0)`.

npm scripts beyond build/start:

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `tsc --watch` | Watch-mode compilation |
| `inspect` | `npx @modelcontextprotocol/inspector node dist/index.js` | MCP inspector for debugging tool calls |
| `test` | `npx tsx suite-test.ts` | Full test suite (all categories) |
| `test:quick` | `npx tsx suite-test.ts --quick` | Quick smoke test subset |
| `verify` | `npx tsc --noEmit && npm run build` | Type-check + build in one step |
| `precommit` | `npm run verify` | Alias for pre-commit hook |

## Test Suite Structure (`suite-test.ts`)

5 test categories, invoked via flags:

| Flag | Category | Scope |
|------|----------|-------|
| `--unit` | Unit | Isolated function tests (cache, logger, config) |
| `--integration` | Integration | Full spawn → MCP response flow |
| `--stress` | Stress/Load | Concurrent commands, large output, rapid fire |
| `--benchmark` | Benchmark | Latency, token savings measurements |
| `--resilience` | Resilience | Timeout, ENOENT, memory limit, malformed input |
| `--quick` | Smoke | Minimal subset for fast feedback |

Run all: `npx tsx suite-test.ts` (or `npm test`).

## Dependency Audit (from BACKLOG.md)

| Dependency | Role | Integration Depth | Notes |
|------------|------|-------------------|-------|
| `@modelcontextprotocol/sdk` | Core MCP | 22% (2/9 files) | StdioServerTransport + tool registration |
| `smol-toml` | Config parse | 11% (1/9) | config.ts only |
| `zod` | Schema validation | 11% (1/9) | schemas.ts only |
| `@types/node` | Dev: TS types | — | Pinned 18.x, consider 22.x LTS |
| `tsx` | Dev: test runner | — | powers `npm test` |
| `typescript` | Dev: compiler | — | v5.9 → v6 major pending |

0 vulnerabilities, 0 deprecations, lockfile clean (v3, 55.9K).

### Known Dead Weight

`hono` is a **direct dependency of the SDK** (Streamable HTTP transport) but this server uses `StdioServerTransport` exclusively — no HTTP/SSE. The SDK pulls it transitively but removing the direct dep is safe.

### Migration Watch Items

- **@modelcontextprotocol/sdk v1→v2**: SSEServerTransport removed, Streamable HTTP migration, Headers API change.
- **zod v3→v4**: `error.flatten()` deprecated → `z.flattenError(err)`. `errorMap` → `error`.
- **typescript v6**: Verify tsconfig compatibility before upgrading.

## Config File: Actual vs Schema

The `rtk-hook.toml` on disk only has the `[execution]` section (4 keys). The code supports a second `[log]` section with defaults:

```toml
[execution]
timeout_ms = 60000
max_buffer_mb = 10
max_log_entries = 1000
debounce_ms = 2000

[log]            # optional — defaults apply if absent
max_active_entries = 1000
max_archives = 10
compress = true   # mapped to compress_archives in ServerConfig
```

All 7 config keys merge into a flat `ServerConfig` Zod schema with defaults for any missing section.
