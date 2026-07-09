# Changelog

## [0.4.0] - 2026-07-06

- feat/major-update: RTK v0.42+, lean docs, backlog audit, schema SVG (#4)

## [0.3.0] - 2026-06-28

- feat: rename server-commands-rtk → commands-rtk
- feat: rewrite executor with spawn, AbortController, error categorization
- feat: apply develop stashes — logger rotation, MCP resources, list_archives
- feat: add CI workflow, MCP client config block, CI badges
- fix: timeout handling — AbortSignal collectStream, short-circuit exitCodePromise
- fix: remove conflict markers from package.json
- fix: add hono direct dep to resolve CVE-2026-54288
- docs: rewrite README for spawn executor, timeout, write_file
- docs: polish README with formatting, backtick refs, Requirements, Resources
- docs: add LICENSE file and MCP badges
- docs: add user experience references 001-003
- chore: pin @modelcontextprotocol/sdk to 1.4.0 (pre-bloat)
- chore: remove RTK_ENHANCEMENT_PROPOSAL.md (archived)
- chore: guardrail — strip CE.md, BACKLOG.md from main
- Initial scaffold with .gitignore and pre-commit hooks

## [0.2.2] - 2026-06-28

- fix: add hono direct dep to resolve CVE-2026-54288 (cherry-picked from develop)

## [0.2.0] - 2026-06-26

- init: scaffold project

[0.4.0]: https://github.com/Ev3lynx727/server-commands-rtk/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Ev3lynx727/server-commands-rtk/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/Ev3lynx727/server-commands-rtk/compare/v0.2.0...v0.2.2
[0.2.0]: https://github.com/Ev3lynx727/server-commands-rtk/releases/tag/v0.2.0
