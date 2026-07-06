# 003_user_experiences.md — Fork build, inputSchema bug, & Pipeline validation

> Date: 2026-06-20
> Status: Active
> Predecessor: docs/references/001_user_experiences.md (Plugin-Level Intercept Attempt & Findings)
> Tags: fork, inputSchema, base64, pipeline, validation, E2E

> Repo: https://github.com/Ev3lynx727/servers (branch: `feat/filesystem-content-base64`)
> Project: `src/filesystem` OpenCode MCP server fork

---

## OVERVIEW

001_user_experiences.md documented the attempted plugin-level intercept strategy (Arch's A/B/C) and concluded that transparent intercept was not feasible in OpenCode 1.17.8.

This session took the alternative route: fork the upstream MCP filesystem server and add optional base64 parameters directly. During the build, a critical bug was discovered: the tool's `inputSchema` was a plain object that excluded the base64 parameters, causing the MCP SDK to silently strip them before the handler ever ran.

---

## THE BUG: inputSchema Excluded Base64 Parameters

On the fork branch, the Zod schemas were properly updated with optional `content_base64` / `newText_base64` parameters:

```typescript
const WriteFileArgsSchema = z.object({
  path: z.string(),
  content: z.string().optional(),
  content_base64: z.string().optional(),
}).refine(
  args => args.content !== undefined || args.content_base64 !== undefined,
  { message: "Must provide either content or content_base64" }
);
```

**But** the tool registration passed a **plain object** as `inputSchema`:

```typescript
// BEFORE — BUG: plain object excludes content_base64
server.registerTool("write_file", {
  inputSchema: {
    path: z.string(),
    content: z.string()        // ← content_base64 missing!
  },
  // ...
}, async (args) => { /* handler supports content_base64 */ });
```

### Root Cause

The MCP SDK's `validateToolInput()` parses incoming args against `tool.inputSchema`. When `inputSchema` is a plain object, `normalizeObjectSchema()` wraps it into a Zod object with **only those fields**. `content_base64` is **silently stripped** during validation — the handler never sees it.

```
Client sends:   { path: "/tmp/x.txt", content_base64: "c29tZQ==" }
                      │                      │
                      ▼                      ▼
SDK validates against: { path: z.string(), content: z.string() }
                      │                      │
                      │                ✗ STRIPPED — not in schema
                      ▼                      ▼
Handler receives:   { path: "/tmp/x.txt" }
                    → args.content === undefined
                    → args.content_base64 === undefined (GONE!)
```

### The Fix

Pass the **full Zod schema**:

```typescript
// AFTER — CORRECT
server.registerTool("write_file", {
  inputSchema: WriteFileArgsSchema,  // ← includes content_base64 + .refine()
  // ...
}, async (args) => { /* now content_base64 survives validation */ });
```

When the SDK receives a Zod schema instance, `getZodSchemaObject()` returns it as-is, preserving all fields and refinements. Same fix applied to `edit_file` with `EditFileArgsSchema`.

---

## E2E VALIDATION

```
STATUS: content_base64 in schema: true
STATUS: write success
STATUS: match: true
✈ ✑ ✐ IT WORKS
```

All 147 existing tests pass — zero regressions.

---

## PIPELINE DIAGRAM

```
[LLM Agent]
  │
  │  1. ENCODE: "some var = `${test}`;"  →  "c29tZS4uLj0="
  │  2. CALL:   write_file(content_base64="c29tZS4uLj0=")
  │
  ▼
[OpenCode MCP Client]
  │
  │  JSON-RPC: {"method":"tools/call","params":{"name":"write_file",
  │    "arguments":{"path":"...","content_base64":"c29tZS4uLj0="}}}
  │
  │  ▲ BASE64 CHARS ONLY [A-Za-z0-9+/=] — JSON-SAFE
  │
  ▼
[stdio pipe]
  │
  ▼
[Forked Filesystem Server (Ev3lynx727/servers, feat/filesystem-content-base64)]
  │
  │  3. SDK validates against inputSchema = WriteFileArgsSchema
  │     → content_base64 PRESERVED ✓
  │
  │  4. Handler (index.ts:364-366):
  │     Buffer.from(content_base64, 'base64').toString('utf-8')
  │     → "some var = `${test}`;"  (original restored)
  │
  │  5. writeFileContent(validPath, content)
  │
  ▼
[Target File]  ✓  Content matches original exactly
```

---

## STRUCTURAL ADVANTAGE

Special characters **never enter the JSON wire format**:

| Layer | What travels | Safe? |
|-------|-------------|-------|
| LLM → Agent args | Raw content (`${}`, backticks, quotes) | In memory only |
| Agent → MCP Client | Base64 string `[A-Za-z0-9+/=]` | ✅ No JSON escaping |
| MCP Client → Server | JSON-RPC with base64 payload | ✅ No escaping issues |
| Server handler | Buffer.from(..., 'base64') decode | ✅ Native Node.js API |
| Disk file | Raw content restored exactly | ✅ Correct output |

No retries. No escaped-escape hell. Zero extra tokens per call beyond the base64 encoding itself (~33% overhead on content payload, negligible vs thousands of tokens in retry loops).

---

## COMMIT HISTORY

```
07368da fix: pass full Zod schemas as inputSchema so content_base64 is exposed
00c3772 feat(filesystem): add optional content_base64 / newText_base64 parameters
```

Branch `feat/filesystem-content-base64` on `Ev3lynx727/servers`.

---

## KEY FILES

| File | Purpose |
|------|---------|
| `src/filesystem/index.ts:113-120` | WriteFileArgsSchema with content_base64 |
| `src/filesystem/index.ts:122-129` | EditOperation with newText_base64 |
| `src/filesystem/index.ts:347-373` | write_file registration (fixed inputSchema) |
| `src/filesystem/index.ts:376-409` | edit_file registration (fixed inputSchema) |
| `~/.config/opencode/opencode.jsonc:68` | Local fork path in MCP config |
| `~/.config/opencode/opencode.jsonc:338` | Transform hook instructing agents |
| `~/dev/proposals/mcp-filesystem/0000-mcp-filesystem-base64.md` | Original contribution proposal |

---

## GAP CLOSED: Auto-mkdir Added to Forked Filesystem

The `commands-rtk_write_file` had auto-mkdir; the forked `filesystem_write_file` did not. Now it does:

```typescript
// index.ts:361
await fs.mkdir(path.dirname(validPath), { recursive: true });
await writeFileContent(validPath, content);
```

### Feature Comparison After Fix

| Feature | Forked Filesystem | commands-rtk |
|---------|------------------|---------------------|
| Base64 param | `content_base64` (optional) | `content_b64` (required) |
| Zod validation | `.refine()` — at least one of content/content_base64 | `z.string().min(1)` |
| Path security | ✅ `validatePath()` + allowed directories | ❌ None |
| Auto-mkdir | ✅ `fs.mkdir(recursive:true)` | ✅ `mkdirSync(recursive:true)` |
| Tool suite | Full filesystem (read, edit, list, search, mkdir) | Only write + run_process |

The forked filesystem now has **all three goodness** (Validation + Path Security + Auto-mkdir), making it the preferred tool for writing files within allowed directories.
