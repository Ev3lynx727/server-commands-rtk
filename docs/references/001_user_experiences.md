# 001_user_experiences.md — Plugin-Level Intercept Attempt & Findings

> Date: 2026-06-20
> Status: Closed
> Predecessor: docs/references/000_user_experiences.md (MCP JSON serialization root cause + token analysis)
> Tags: plugin, hook, redirect, tool-override, opencode

---

## OVERVIEW

This document captures the attempt to build a transparent OpenCode plugin that intercepts `filesystem_write_file` calls with content containing special characters and automatically redirects them to `commands-rtk_write_file` (base64-encoded). Three architectures were evaluated. None achieved transparent interception — but the investigation revealed important constraints of the OpenCode plugin system and a change in the reliability of the upstream MCP filesystem server.

---

## LINK-UP: 000_user_experiences.md

000_user_experiences.md established:
- MCP tool params are JSON-serialized; `"`, `` ` ``, `${}`, and long strings break the framing
- `commands-rtk_write_file` with `content_b64` reliably handles any content
- Base64 overhead (~50% token premium) is offset by eliminating retries

This session attempted to **automate the redirect** — so the agent can keep calling `filesystem_write_file` and the plugin silently routes to base64 when needed.

---

## ARCHITECTURES EVALUATED

### Arch A: Proxy MCP Server
Wrap the filesystem MCP server, intercept `filesystem_write_file`, handle special chars internally.

**Status:** Rejected early (unnecessary complexity — deploy and maintain a separate process)

### Arch B: `tool.execute.before` Hook Redirect
Use the `"tool.execute.before"` hook to detect special chars in content and mutate `input.tool` to `"commands-rtk_write_file"` + rewrite `output.args` with `content_b64`.

**Implementation:** `~/.config/opencode/plugins/mcp-intercept.ts`
**Result:** ❌ Hook fires but `input.tool` mutation does not cause re-dispatch. The MCP tool dispatcher resolves the target handler before the hook fires — changing the tool name after dispatch does nothing.

### Arch C: Plugin `tool` Property Override
Register `filesystem_write_file` and `write` in the plugin's `tool` property backed by direct `fs.writeFileSync`, intending to override the MCP/built-in tools by name.

**Implementation:** Same plugin file, switched to `tool` property approach
**Result:** ❌ MCP tools take priority over plugin-registered tools with the same name. OpenCode's tool resolution checks MCP servers before plugin tools.

---

## PLUGIN SYSTEM FINDINGS

### Export Formats That Work

| Format | Loads? | Notes |
|--------|--------|--------|
| `export default async function(input): Promise<Hooks>` | ✅ | `Plugin` function format |
| `const server: Plugin = async (...) => ...; export default serverc | ✅ | Same, typed |
| `export { server }; export default server` | ✅ | Named + default for compatibility |
| `export default { id, server: async (...) => ... }` | ✅ | `PluginModule` format |
| `export default tool({...})` | ❌ | `"Plugin export is not a function"` |
| `export const server = tool({...})` | ❌ | Same error |

### Hook: `tool.execute.before`
```typescript 
"tool.execute.before"?: (input: {
    tool: string;
    sessionID: string;
    callID: string;
}, output: {
    args: any;
}) => Promise<void>;
```
- **Fires:** ✅ Confirmed by type definitions
- **Can modify `output.args`:** ✅ Content mutations apply before dispatch
- **Can modify `input.tool`:** ❌ Mutation has no effect — dispatcher resolved handler already
- **Can cancel execution:** ❌ No return/throw mechanism to prevent original tool from running

### Tool Override via `tool` Property
```typescript 
tool: {
  filesystem_write_file: { description, args, execute }  // never called
}
```
- Plugin tools with the same name as MCP tools are **shadowed** — MCP always wins.
- Resolution order: built-in tools → MCP server tools → plugin tools

---

## STRESS TEST: MCP filesystem server v2026.1.14

A 45KB payload with heavy special characters was written via `filesystem_write_file`:

```
Content: 90 lines, every line containing:
  - Backticks: `code{N}`
  - Double quotes: "quote{N}"
  - Template literals: ${var{N}}
  - JSON-like: {"key": "val{N}"}
```

**Result:** ✅ Written correctly. Zero errors. All characters survived.

This contradicts the original finding in 000_user_experiences.md. Possible explanations:
1. **Version fix**: `@modelcontextprotocol/server-filesystem` was updated since the original UX — v2026.1.14 (Jan 2026) may include JSON serialization fixes
2. **Tool-specific**: The original failure may be limited to the OpenCode built-in `write` tool (which uses a different transport layer), not the MCP `filesystem_write_file` tool
3. **Environment-specific**: The MCP SDK version, Node.js version, or transport layer may affect serialization behavior

---

## UPDATED COMPARISON

| Criteria | Direct Write (MCP) | write_file (Base64) | run_process Heredoc |
|----------|-------------------|---------------------|---------------------|
| **Reliability (current env)** | ✅ Works with all chars | ✅ Always works | ✅ Always works |
| **Reliability (historical)** | ❌ Broke on special chars | ✅ Always works | ✅ Always works |
| **Token overhead** | None (baseline) | +50-56% on content | ~0 (content in subprocess) |
| **Ergonomics** | Best (native tool) | Good (single tool) | Poor (manual escaping) |
| **Binary support** | ✅ | ✅ | ❌ Text only |

---

## UPDATED DECISION RULE

```
if using @modelcontextprotocol/server-filesystem >= 2026.1.14:
    use filesystem_write_file  # 0% overhead, works reliably
else if content_has_special_chars:
    if token_budget_is_plentiful:
        use commands-rtk_write_file  # ~50% overhead, simple
    else:
        use run_process heredoc             # 0% overhead, manual
else:
    use filesystem_write_file               # 0% overhead, native
```

---

## FILES

| File | Purpose |
|------|---------|
| `~/.config/opencode/plugins/mcp-intercept.ts` | OpenCode plugin — Arch B + C implementations (currently inert, kept as reference) |
| `~/server/commands-rtk/src/server.ts` | `write_file` tool with base64 support |
| `~/.config/opencode/opencode.jsonc` | MCP server config (filesystem, commands-rtk) |

---

## IMPLEMENTED

- `"experimental.chat.system.transform"` hook added to `opencode.jsonc:338` (2026-06-20). Instructs all agents to prefer `commands-rtk_write_file` with base64 content for any file containing special characters.

## REMAINING FUTURE WORK

- Monitor `@modelcontextprotocol/server-filesystem` releases for regression — if JSON serialization issue reappears, consider an MCP gateway proxy at the transport layer
- Verify hook behavior across different agent types (primary vs subagent)

---

*Last Updated: 2026-06-20*/
*Author: Debug session, plugin architecture investigation*/
