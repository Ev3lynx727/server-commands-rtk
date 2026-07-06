# BENCHMARK.md — Performance Benchmarks

> Date: 2026-07-06
> Version: v0.3.0 (RTK v0.43.0, OpenCode v1.17)
> Status: Active

---

## OVERVIEW

This document tracks performance benchmarks for the `commands-rtk` MCP server, including execution latency, builtin passthrough logic, cache performance, and token reduction via RTK filtering.

**Architecture:** executor.ts prepends `rtk` to external commands (git, docker, npm, ls...) with two passthrough exceptions:
- **Shell builtins** (`cd`, `exit`, `export`, `source`, `.`, `set`, `alias`, `pushd`...) — no `rtk` prefix
- **Compound commands** (`&&`, `||`, `;`, `|`) — no `rtk` prefix (RTK can't resolve shell operators)
No subprocess overhead — string concat only.

---

## SEQUENTIAL EXECUTION LATENCY

### Test Methodology

- **Tool:** `run_process` via MCP (stdio transport)
- **Commands:** Simple `echo` statements
- **Measurement:** `duration_ms` from suite-test.ts benchmark section

### Results (from suite-test.ts benchmark — v0.3.0)

| Metric | Cache Miss | Cache Hit |
|--------|-----------|-----------|
| **Mean Latency** | ~65ms | ~4ms |
| **Speedup** | 1x | ~17x |
| **Sample Size** | 5 trials each | 5 trials each |

### Analysis

1. **Cache miss latency** (~65ms) includes: command execution, cache write
2. **Cache hit latency** (~4ms) is pure Map lookup — no I/O
3. **Speedup** of 17x makes repeated commands effectively free
4. Token savings from RTK (~60-90%) dwarf any latency difference

---

## TOKEN REDUCTION (RTK FILTERING)

### Global Statistics (from `rtk gain`)

| Metric | Value |
|--------|-------|
| **Total Commands** | 4,493 |
| **Input Tokens** | 16.2M |
| **Output Tokens** | 4.4M |
| **Tokens Saved** | 11.8M (73.0%) |
| **Total Exec Time** | 606m9s (avg 8.1s) |

### By Command Type

| Command | Count | Savings | Avg% | Notes |
|---------|-------|---------|------|-------|
| `rtk curl` (API calls) | 5 | ~6.5M | 99.5% | JSON/HTML responses compress heavily |
| `rtk grep` | 66 | 2.1M | 16.0% | Dense search output |
| `rtk read` | 62 | 2.0M | 38.7% | Dense text |
| `rtk find` | 61 | 190.2K | 53.2% | File listings |
| `rtk ps aux` | 60 | 201.4K | 79.1% | Process lists |
| `rtk git commit` | 39 | 152.9K | 84.2% | Structured output |
| `rtk git status` | 20 | 127.6K | 59.2% | Structured output |

### Observations

- **High token commands** (curl) see 99%+ reduction — JSON responses compress heavily
- **Text search** (grep) sees modest 16% reduction but high absolute savings (2.1M tokens)
- **Overall 73%** savings — 4,493 commands tracked globally, 573 via commands-rtk `run_process`
- commands-rtk execution log matches RTK schema: 573 entries, no stale fields in recent records

---

## RTK PASSTHROUGH LOGIC

executor.ts uses two guards to skip the `rtk` prefix:

| Guard | Pattern | Skip `rtk`? | Examples |
|-------|---------|-------------|----------|
| **isBuiltin** | `/^(cd\|pushd\|popd\|export\|source\|\\.\|set\|unset\|alias\|unalias\|exit\|trap\|exec\|type)($\|\s)/` | Yes | `cd /x`, `exit 42`, `export PATH=...` |
| **isCompound** | `/[;&|]/` after stripping quoted strings | Yes | `a && b`, `a \| b`, `a; b` |
| Default | All other commands | No (RTK prefixes) | `git status`, `docker ps`, `npm run` |

**RTK v0.43.0** has dedicated subcommands for 50+ tools: git, docker, npm, npx, gh, cargo, pip, go, tsc, jest, ls, find, grep, rg, curl, kubectl...

---

## CACHE PERFORMANCE

### Cache Hit/Miss Latency

| Operation | Latency | Notes |
|-----------|---------|-------|
| Cache Miss (first run) | ~65ms | Includes command execution |
| Cache Hit (subsequent) | ~4ms | Metadata lookup only |
| Cache Write | ~5-10ms | JSON serialization + debounced disk I/O |

### Cache Statistics

Run `get_cache_stats` tool to see current hits/misses:

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

---

## CONFIGURABLE SETTINGS (rtk-hook.toml)

### Current Configuration

```toml
[execution]
timeout_ms = 60000
max_buffer_mb = 10
max_log_entries = 1000
debounce_ms = 2000

[log]
max_active_entries = 1000
max_archives = 10
compress = true
```

### Impact of Settings

| Setting | Low Value | High Value | Recommendation |
|---------|-----------|------------|----------------|
| `timeout_ms` | Fast failure | Long waits | 60000 (60s) default |
| `max_buffer_mb` | Truncated output | High memory | 10MB default |
| `max_log_entries` | Lost history | High disk usage | 1000 default |
| `debounce_ms` | More disk writes | Staler cache on crash | 2000 default |

---

## RECOMMENDATIONS

### For Production Use

1. **Monitor log size** — 1000 entries at ~3MB is safe
2. **Adjust timeout** — Increase for long-running builds/installs
3. **RTK on by default** — simple commands auto-prefixed, builtins/compound skip
4. **Use `cwd` param** — avoid `cd &&` in command strings (triggers `isCompound` guard)
5. **Clear cache** via `clear_command_cache` if stale entries accumulate

### For Training Data Export

1. **Single source** — `~/.local/share/state/commands-rtk/execution-log.jsonl` has full stdout/stderr
2. **Filter by model** — Use `model_used` field to segment

---

## TRANSPORT SECURITY

### Why stdio is used (not StreamableHTTP)

| Aspect | stdio | StreamableHTTP |
|--------|-------|----------------|
| **Network Exposure** | None (local only) | Exposed to network |
| **Authentication** | Process isolation | Requires auth |
| **Attack Surface** | Minimal | Higher |
| **Use Case** | Single-user local | Multi-user / remote |

Stdio is the default — no network exposure, no auth needed, minimal attack surface.

---

*Last Updated: 2026-07-06*
*Benchmark Tool: `commands-rtk` v0.3.0*
*OpenCode v1.17*
