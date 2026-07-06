# BENCHMARK.md — Performance Benchmarks

> Date: 2026-07-03
> Version: v0.3.0 (OpenCode v1.17)
> Status: Active

---

## OVERVIEW

This document tracks performance benchmarks for the `commands-rtk` MCP server, including execution latency, `tryRewrite` overhead, cache performance, and token reduction via RTK filtering.

**Key difference from v0.2:** `tryRewrite()` replaced `prependRtk()`. Instead of blindly prefixing every command with `rtk`, it calls `rtk rewrite <cmd>` as a subprocess to determine if RTK has a filter. Adds ~55-65ms overhead on the first call per unique command, but avoids spawning `rtk` for commands it doesn't filter (`which`, `echo`, `cd`).

---

## TRYREWRITE OVERHEAD

### v0.2: `prependRtk()` → v0.3: `tryRewrite()`

| Factor | v0.2 `prependRtk` | v0.3 `tryRewrite` | Impact |
|--------|-------------------|-------------------|--------|
| Cost | **0ms** (string concat) | **~58ms** (`execFileSync` subprocess) | +58ms first-call |
| Dispatch | Blind `rtk <cmd>` prefix | Smart `rtk rewrite <cmd>` detection | Smarter, skips unfiltered commands |
| `rtk_rewritten` signal | N/A | `true`/`false` in response + log | Better observability |
| `rtk_compact` mode | N/A | `-u` flag appended on rewrite | Extra token savings on demand |

### `rtk rewrite` Subprocess Times (ms)

| Command | Min | Avg | Max |
|---------|-----|------|-----|
| `rtk rewrite "git status"` (has filter) | 54ms | 58ms | 65ms |
| `rtk rewrite "echo hello"` (no filter, exit 1) | ~15ms | ~20ms | ~30ms |
| `rtk rewrite "which curl"` (no filter, exit 1) | ~12ms | ~18ms | ~25ms |

### Execution Time: First Call (no cache)

| Case | `tryRewrite` | `executeCommand` | **Total** |
|------|-------------|------------------|-----------|
| v0.2 — `rtk git status` | 0ms | ~117ms | **~117ms** |
| v0.3 — `rtk git status` | ~58ms | ~117ms | **~175ms** |
| v0.3 — `which curl` (passthrough) | ~18ms | ~2ms | **~20ms** |

### Execution Time: Cache Hit (repeat call)

| Case | Lookup | **Total** |
|------|--------|-----------|
| Any command (v0.2 or v0.3) | ~4ms | **~4ms** |

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

1. **Cache miss latency** (~65ms) includes: `tryRewrite` subprocess, command execution, cache write
2. **Cache hit latency** (~4ms) is pure Map lookup — no I/O
3. **Speedup** of 17x makes repeated commands effectively free
4. v0.3 is slightly slower than v0.2 (~60ms → ~65ms) due to `tryRewrite` subprocess overhead

---

## TOKEN REDUCTION (RTK FILTERING)

### Global Statistics (from `rtk gain`)

| Metric | Value |
|--------|-------|
| **Total Commands** | 3,089 |
| **Input Tokens** | 8.2M |
| **Output Tokens** | 651.7K |
| **Tokens Saved** | 7.5M (92.0%) |
| **Total Exec Time** | 132m10s (avg 2.6s) |

### By Command Type

| Command | Count | Savings | Avg% | Notes |
|---------|-------|---------|------|-------|
| `rtk curl` (API calls) | 6 | ~6.6M | 99.4% | JSON/HTML responses compress heavily |
| `rtk find` | 51 | 190.2K | 59.1% | File listings |
| `rtk git status` | 13 | 127.4K | 63.4% | Structured output |
| `rtk tsc --noEmit` | 7 | 92.8K | 33.9% | Error/warning dense |
| `rtk read` | 15 | 76.9K | 18.5% | Dense text |
| `rtk:toml ps aux` | 31 | 114.9K | 80.6% | Process lists |

### Observations

- **High token commands** (curl, find) see 59-99% reduction
- **Dense output** (read, tsc) sees modest 18-34% reduction but still worthwhile
- **Overall 92%** savings means ~13x effective context multiplier

---

## SIGNAL FIELDS (NEW IN v0.3)

`run_process` response and execution log now return:

| Field | Type | Meaning |
|-------|------|---------|
| `rtk_filtered` | bool | RTK was enabled for this command |
| `rtk_rewritten` | bool | `rtk rewrite` found a filter and rewrote the command |

Use cases:
- `rtk_filtered: true` + `rtk_rewritten: true` → filtered by RTK
- `rtk_filtered: true` + `rtk_rewritten: false` → RTK enabled but no filter → raw passthrough
- `rtk_filtered: false` + `rtk_rewritten: false` → bypassed via `use_raw: true`

---

## CACHE PERFORMANCE

### Cache Hit/Miss Latency

| Operation | Latency | Notes |
|-----------|---------|-------|
| Cache Miss (first run) | ~65ms | Includes `tryRewrite` + command execution |
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
3. **Use RTK filtering by default** — 92% savings is significant
4. **Use `rtk_compact` for output-heavy commands** — adds `-u` ultra-compact mode
5. **Clear cache** via `clear_command_cache` if stale entries accumulate

### For Training Data Export

1. **Single source** — `~/.local/share/state/commands-rtk/execution-log.jsonl` has full stdout/stderr + `rtk_rewritten` signal
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

*Last Updated: 2026-07-03*
*Benchmark Tool: `commands-rtk` v0.3.0*
*OpenCode v1.17*
