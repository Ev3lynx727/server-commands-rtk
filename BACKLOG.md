# Backlog

## Dependency Audit — 2026-06-28

| Dependency | Type | Integration | Effect % | Files | Verdict |
|------------|------|-------------|----------|-------|---------|
| @modelcontextprotocol/sdk | dep | Module | 22% | 2/9 | Significant — core MCP server, transport, types (3 imports in server.ts) |
| hono | ~~dep~~ | ~~Dead~~ | 0% | 0/9 | **Removed.** Stdio-only server — no HTTP transport. Now only transitive via SDK. |
| smol-toml | dep | Module | 11% | 1/9 | Peripheral — config parsing only (config.ts) |
| zod | dep | Module | 11% | 1/9 | Peripheral — schema validation only (schemas.ts) |
| @types/node | devDep | Module | — | — | TypeScript type definitions |
| tsx | devDep | CLI | — | — | Test runner (suite-test.ts) |
| typescript | devDep | Module | — | — | Compiler (tsc) |

### Outdated Packages

| Package | Current | Latest | Action |
|---------|---------|--------|--------|
| @types/node | 18.19.130 | 26.0.1 | Update if Node target changes |
| hono | 4.12.26 | 4.12.27 | Minor bump (CVE-tracked, check SDK compat) |
| smol-toml | 1.6.1 | 1.7.0 | Minor bump |
| typescript | 5.9.3 | 6.0.3 | Major — test compat before upgrading |
| zod | 3.25.76 | 4.4.3 | Major — API breaking, test before upgrading |

### Health Checks

| Check | Status |
|-------|--------|
| Vulnerabilities | ✅ 0 (0 high, 0 critical across 124 transitive deps) |
| Deprecations | ✅ None |
| Build | ✅ Compiles cleanly |
| Lockfile | ✅ package-lock.json present (55.9K) |
| Lockfile integrity | ✅ (lockfileVersion 3, no regen warning) |

### Migration Notes (Context7)

- **@modelcontextprotocol/sdk v1.x → v2**: Breaking changes:
  - `SSEServerTransport` removed — migrate to Streamable HTTP. Frozen v1 copy at `@modelcontextprotocol/server-legacy/sse` as bridge.
  - `StreamableHTTPError` removed.
  - `requestInit.headers` must use Web Standard `Headers` object, not plain objects.
  - v2 appends custom `Accept` headers to spec-required ones instead of replacing.
- **zod v3 → v4**: Breaking changes:
  - `errorMap` param replaced with `error` param (accepts string or `$ZodErrorMap`).
  - `error.flatten()` deprecated — use `z.flattenError(err)`.
  - Side-by-side import possible: `z3` from `zod/v3`, `z4` from `zod/v4/core`.
  - Check `_zod` property to differentiate v3/v4 schemas at runtime.
- **hono v4**: Minor bumps only. No breaking changes expected in v4.x. Node.js adapter requires Node >18.14.1.
- **typescript v6**: Verify `tsconfig.json` compatibility before upgrading.

### Notes

- **hono**: **Dead weight.** Stdio-only server (`StdioServerTransport` at `server.ts:459`) — no HTTP/SSE transport. `hono` is only used by the SDK's Streamable HTTP transport, which this project doesn't use. Remove from dependencies entirely. The SDK still pulls it transitively but won't fail without the direct dep.
- **@types/node**: Pinned to 18.x — consider bumping to 22.x LTS to use modern Node APIs.
- **zod v4**: Breaking changes from v3. Audit API surface before upgrading (`errorMap` → `error`, `flatten()` deprecated).
- **typescript v6**: Breaking changes. Verify `tsconfig.json` compatibility.
