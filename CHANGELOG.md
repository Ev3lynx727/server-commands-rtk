# Changelog

## [0.3.0] — 2026-07-03

### Added

- `resolve_uri` tool — resolves `scheme://path` to absolute file paths via shared TOML config
- `src/resolver.ts` — URI resolution module (forked from uri-resolver), exposes `resolveUri()`, `listSchemes()`, `SchemeEntry`
- `ResolveUriArgs` Zod schema in schemas.ts

### Changed

- **State files relocated** from install directory to `~/.local/share/state/commands-rtk/` (command-cache.json, execution-log.jsonl)
- Scheme registry now reads `~/.config/uri-resolver/config.toml` as primary source, with `MCP_RESOURCE_ROOTS` env var as fallback
- Resource root handlers refactored from local `resolvedRoots` array to class property `this.roots` with typed `SchemeEntry`
- Archived logs co-locate with active log in the state directory

### Removed

- `MCP_RESOURCE_ROOTS` from OpenCode config (replaced by shared TOML config)
- `hono` direct dependency (previously pinned for CVE mitigation, now handled transitively by SDK)

### Documentation

- README: resolve_uri usage, state paths, updated MCP Resources section
- CE.md: tool count 6→7, resolver.ts + ResolveUriArgs, updated diagram with state dir
- index.ts --help: restored write_file listing, added MCP_RESOURCE_ROOTS to env vars
- BENCHMARK.md, OPENCODE_INTEGRATION.md: fixed stale state file paths
- suite-test.ts: resilience test cache path updated

## [0.2.2] — 2026-06-25

### Fixed

- Added `hono` as direct dependency to resolve CVE-2026-54288 (transitive from SDK)

## [0.2.1] — 2026-06-20

### Added

- Path security: `validatePath()` + `allowed_directories` config
- User experience reference docs 004-005

## [0.2.0] — 2026-06-15

### Added

- Full spawn-based executor with AbortController timeout
- Error categorization (7 categories)
- Execution logger with auto-rotation and gzip compression
- MCP resource templates via MCP_RESOURCE_ROOTS
- `write_file` tool with base64 content
- `list_archives` tool

### Changed

- Rewrote from exec-based to spawn-based execution (no maxBuffer ceiling)
- RTK wrapping now uniform (v0.1.0 per-command wrapper config removed)
- Cache key changed to SHA-256 of (command + cwd)

## [0.1.0] — 2026-06-10

### Added

- Initial scaffold with basic command execution
- RTK token minimization integration
- Simple JSON cache
- Stdio MCP transport
