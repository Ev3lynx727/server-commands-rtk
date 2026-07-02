# BENCHMARK.md — Performance Benchmarks

> Date: 2026-06-19
> Status: Active

---

## OVERVIEW

This document tracks performance benchmarks for the `server-commands-rtk` MCP server, including execution latency, token reduction via RTK, and cache performance.

---

## SEQUENTIAL EXECUTION LATENCY

### Test Methodology

- **Tool:** `run_process` via MCP (stdio transport)
- **Commands:** Simple `echo` statements
- **Measurement:** `duration_ms` from test suite

### Results (from suite-test.ts benchmark section)

| Metric | Cache Miss | Cache Hit |
|--------|-----------|-----------|
| **Mean Latency** | ~124-173ms | ~0.4-0.6ms |
| **Speedup** | 1x | ~250-430x |
| **Sample Size** | 5 trials each | 5 trials each |

### Analysis

1. **Cache miss latency** (~124-173ms) includes: process spawn, command execution, RTK filtering, and cache write
2. **Cache hit latency** (~0.4-0.6ms) is pure Map lookup — no I/O
3. **Speedup** of 250-430x makes repeated commands essentially free

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

## CACHE PERFORMANCE

### Cache Hit/Miss Latency

| Operation | Latency | Notes |
|-----------|---------|-------|
| Cache Miss (first run) | ~50-80ms | Includes command execution |
| Cache Hit (subsequent) | ~0.4-0.6ms | Metadata lookup only |
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
4. **Clear cache** via `clear_command_cache` if stale entries accumulate

### For Training Data Export

1. **Single source** — `~/.local/share/state/server-commands-rtk/execution-log.jsonl` has full stdout/stderr
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

*Last Updated: 2026-06-19*
*Benchmark Tool: `server-commands-rtk` v0.2.0*
