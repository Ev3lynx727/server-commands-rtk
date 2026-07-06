# 002_user_experiences.md — commands-rtk write_file & Transform Hook

> Date: 2026-06-20
> Status: Active
> Predecessor: docs/references/001_user_experiences.md (Plugin-Level Intercept Attempt & Findings)
> Tags: commands-rtk, write_file, base64, transform, hook, opencode

---

## OVERVIEW

001_user_experiences.md concluded that transparent plugin-level intercept of `filesystem_write_file` was not feasible in OpenCode 1.17.8 (Arch A/B/C all failed).

This document captures the two outcomes of that conclusion:

1. **commands-rtk `write_file`** — a dedicated MCP tool with required `content_b64` parameter, written as a pragmatic workaround. No path security, no Zod refine — just a simple base64 write tool.

2. **`experimental.chat.system.transform` hook** — a system-level prompt injection added to `opencode.jsonc:338` that instructs all agents to prefer base64-encoded writes over raw content, preventing the JSON serialization problem at the source.

---

## commands-rtk write_file

Created as a minimal, focused utility alongside the existing `run_process` tool.

**Registration** (`src/server.ts:117-135`):
- Tool name: `write_file`
- Parameters: `path` (required string), `content_b64` (required string)
- No `.refine()` fallback — always requires base64
- Decode: `Buffer.from(content_b64, "base64").toString("utf8")`
- Auto-mkdir: `mkdirSync(dir, { recursive: true })`
- Path security: ❌ None at this time

**Design rationale**: Kept simple and unrestricted. It's a fallback tool — when the filesystem server's `write_file` can't handle special characters, this tool always works because base64 is JSON-inert.

---

## Transform Hook

Added to `opencode.jsonc:338`:

```
experimental.chat.system.transform
```

Instructs every agent at session start to:
- PREFER `filesystem_write_file(content_base64=...)` (when available)
- FALLBACK `commands-rtk_write_file(content_b64=...)`
- NEVER use the built-in write tool for special-character content

This is a proactive fix — it prevents the JSON serialization regression before it happens, regardless of which MCP servers are configured.

---

## Relationship to 003_user_experiences.md

003_user_experiences.md builds on this work by taking the fork approach: modifying the upstream filesystem server to support `content_base64` natively, fixing the `inputSchema` bug, and closing the gap with auto-mkdir + path security.
