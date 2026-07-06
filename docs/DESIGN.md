# DESIGN.md

Architecture decisions and constraints for commands-rtk.

## Architecture

Stdio-only MCP server. Single `McpServer` instance with `StdioServerTransport`. All tool logic in 9 `src/` files. RTK wrapping via prefix in `executor.ts` — not subprocess rewrite.

## Decisions

- **spawn() over exec()**: No maxBuffer ceiling. Pipes stream in real-time. AbortController + SIGKILL for hard kill.
- **RTK as prefix, not subprocess**: `"rtk " + cmd` in executor.ts. No tryRewrite subprocess wrapping. Simpler, no JSON envelope overhead.
- **TOML config over JSON**: `rtk-hook.toml` for config. `smol-toml` parser (no YAML dep).
- **write_file base64 workaround**: MCP SDK JSON serialization breaks on quotes/backticks. Base64 param side-steps it.
- **SHA-256 cache key**: `(command + cwd)` hashed. Cache file at state dir. Persists across restarts.
- **JSONL rolling log**: Append-only. Rotation at `max_log_entries`. Gzip compression for archives.
- **URI resolver via TOML**: Shared `~/.config/uri-resolver/config.toml`. `MCP_RESOURCE_ROOTS` env var as fallback.

## Constraints

- Node 24+, ESM only
- RTK CLI must be on PATH
- Shell builtins incompatible with RTK prefix
- No SSE transport. Single-client stdio only.
