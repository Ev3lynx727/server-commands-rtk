# CE.md

> AI entry point — see root-level [CE.md](../CE.md) for full context.

commands-rtk is an MCP server wrapping shell execution with RTK token minimization.

## Quick ref

- **Transport**: stdio only (single client per process)
- **Config**: `rtk-hook.toml` at repo root
- **State dir**: `~/.local/share/state/commands-rtk/`
- **Key tool**: `run_process` — spawns with `rtk` prefix
- **Cache**: persistent JSON (`command-cache.json`)
- **Log**: append-only JSONL with rotation

See [ARCHITECTURE.md](./ARCHITECTURE.md), [DESIGN.md](./DESIGN.md), and root [CE.md](../CE.md) for depth.
