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

---
*Audit run: 2026-07-06*

## Changelog Audit Trail

| Metric | Value |
|--------|-------|
| Total commits (no-merges) | 0 |
| Last tagged version | 0.3.0 |
| Changelog entries | 5 versions |
| Untracked commits (post last changelog) | 0 |

## Implementation Audit Trail

| Metric | Count |
|--------|-------|
| Doc files scanned | 10 |
| Source files scanned | 9 |
| :implemented claims | 0 |
| :pending/:wip/:blocked claims | 0 |
| :nextstep markers | 0 |
| :bug references | 5 |
| TODO in source | 0 |
| FIXME in source | 0 |

### Doc Files Scanned

- BACKLOG.md
- CE.md
- CHANGELOG.md
- README.md
- docs/BENCHMARK.md
- docs/OPENCODE_INTEGRATION.md
- docs/references/000_user_experiences.md
- docs/references/001_user_experiences.md
- docs/references/002_user_experiences.md
- docs/references/003_user_experiences.md

### Source Files Scanned

- src/cache.ts
- src/config.ts
- src/errors.ts
- src/executor.ts
- src/index.ts
- src/logger.ts
- src/resolver.ts
- src/schemas.ts
- src/server.ts

### Bug References

| File | Line | Text |
|------|------|------|
| docs/references/002_user_experiences.md | 57 | 003_user_experiences.md builds on this work by taking the fork approach: modifying the upstream filesystem server to sup |
| docs/references/003_user_experiences.md | 1 | # 003_user_experiences.md — Fork build, inputSchema bug, & Pipeline validation |
| docs/references/003_user_experiences.md | 17 | This session took the alternative route: fork the upstream MCP filesystem server and add optional base64 parameters dire |
| docs/references/003_user_experiences.md | 21 | ## THE BUG: inputSchema Excluded Base64 Parameters |
| docs/references/003_user_experiences.md | 39 | // BEFORE — BUG: plain object excludes content_base64 |

## Issues Audit Trail

| Metric | Count |
|--------|-------|
| Fixed (git log) | 0 |
| Open in source (FIXME/BUG/HACK/etc) | 0 |
| Documented issues | 5 |
| Total outstanding | 5 |

### Documented Issues

| File | Line | Keyword | Text |
|------|------|---------|------|
| docs/references/000_user_experiences.md | 51 | workaround | ### Approach B: run_process Heredoc Workaround |
| docs/references/000_user_experiences.md | 115 | workaround | | Criteria | Direct Write | run_process Workaround | write_file (Base64) | |
| docs/references/000_user_experiences.md | 151 | workaround | | Maximizing token budget | `run_process` heredoc workaround (0 overhead, worse ergonomics) | |
| docs/references/000_user_experiences.md | 169 | workaround | - If MCP SDK adds binary/blob parameter support (e.g., base64 native type), the workaround becomes unnecessary |
| docs/references/002_user_experiences.md | 16 | workaround | 1. **commands-rtk `write_file`** — a dedicated MCP tool with required `content_b64` parameter, written as a pragmatic wo |

## Open Pull Requests

| Metric | Count |
|--------|-------|
| Total open PRs | 1 |
| Draft | 0 |
| Ready for review | 1 |
| Needs review | 1 |
| Stale (>14d) | 0 |
| CI failing | 0 |

Remote: `https://github.com/Ev3lynx727/mcp-commands-rtk.git`

| # | Title | Author | Status | Draft | CI | Updated |
|---|-------|--------|--------|-------|-----|---------|
| #3 | chore(deps): bump @modelcontextprotocol/sdk from 1.4.0 to 1. | app/dependabot | review | no | pass | 2026-07-06 |

