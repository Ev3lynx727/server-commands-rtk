import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import type { SchemeEntry } from "./resolver.js";
import { expandHome, resolveUri, listSchemes } from "./resolver.js";
import {
  RunProcessArgs,
  ExecutionLogArgs,
  WriteFileArgs,
  ResolveUriArgs,
} from "./schemas.js";
import type { ServerConfig } from "./schemas.js";
import { loadConfig } from "./config.js";
import { parse } from "smol-toml";
import { CommandCache } from "./cache.js";
import { ExecutionLogger } from "./logger.js";
import { executeCommand } from "./executor.js";
import { tryRewrite } from "./rtk.js";
import { categorizeError } from "./errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class ServerCommandsRTK {
  private readonly server: Server;
  private readonly config: ServerConfig;
  private readonly cache: CommandCache;
  private readonly logger: ExecutionLogger;
  private readonly roots: SchemeEntry[] = [];
  private clientName: string | null = null;

  constructor() {
    const serverDir =
      process.env.SERVER_DIR ||
      path.resolve(__dirname, "..");

    this.config = loadConfig(path.join(serverDir, "rtk-hook.toml"));

    const logDir = path.join(expandHome("~/.local/share"), "state/commands-rtk");
    mkdirSync(logDir, { recursive: true });
    this.cache = new CommandCache(
      path.join(logDir, "command-cache.json"),
      this.config.debounce_ms,
    );
    this.logger = new ExecutionLogger(
      path.join(logDir, "execution-log.jsonl"),
      this.config.max_active_entries,
      this.config.max_archives,
      this.config.compress_archives,
    );

    this.server = new Server(
      { name: "commands-rtk", version: "0.2.0" },
      { capabilities: { tools: {}, resources: {} } },
    );

    this.server.oninitialized = () => {
      const client = this.server.getClientVersion();
      if (client?.name) {
        this.clientName = client.name;
      }
    };

    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        {
          name: "run_process",
          description:
            "Run shell command with RTK auto-filtering (default: enabled)",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string" },
              cwd: { type: "string" },
              description: { type: "string" },
              clear_cache: {
                type: "boolean",
                default: false,
              },
              use_rtk_filter: {
                type: "boolean",
                default: true,
                description:
                  "Auto-wrap with RTK for token-minimized output (default: true)",
              },
              rtk_compact: {
                type: "boolean",
                default: false,
                description:
                  "Ultra-compact RTK mode: ASCII icons, inline format (extra token savings)",
              },
              use_raw: {
                type: "boolean",
                default: false,
                description:
                  "Run raw command without RTK filtering (bypasses auto-RTK)",
              },
              model_used: {
                type: "string",
                description:
                  "Model name that executed this command (for training metadata)",
              },
              timeout_ms: {
                type: "number",
                description:
                  "Per-command timeout in milliseconds (overrides server default)",
              },
            },
            required: ["command"],
          },
        },
        {
          name: "get_cache_stats",
          description: "Get cache statistics",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "clear_command_cache",
          description: "Clear all cached commands",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "cached_commands",
          description: "List all cached commands",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "execution_log",
          description: "Get execution log (last N entries, optionally including archives)",
          inputSchema: {
            type: "object",
            properties: {
              limit: { type: "number", default: 100 },
              include_archives: {
                type: "boolean",
                default: false,
                description: "Include rotated archive files for full history",
              },
            },
          },
        },
        {
          name: "list_archives",
          description: "List all rotated log archive files for dataset pipeline",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "write_file",
          description:
            "Write a file with base64-encoded content. Use this instead of write/filesystem_write_file when content contains special chars that break JSON serialization.",
          inputSchema: {
            type: "object",
            properties: {
              path: {
                type: "string",
                description: "Absolute path to output file",
              },
              content_b64: {
                type: "string",
                description: "Base64-encoded file content",
              },
            },
            required: ["path", "content_b64"],
          },
        },
        {
          name: "resolve_uri",
          description:
            "Resolve a scheme:// URI to an absolute file path. Uses schemes registered via MCP_RESOURCE_ROOTS env var (headquarters://, vaults://, etc.). scheme://. resolves to the base directory.",
          inputSchema: {
            type: "object",
            properties: {
              uri: {
                type: "string",
                description: "URI to resolve, e.g. headquarters://docs/api.md or vaults://.",
              },
            },
            required: ["uri"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const { name, arguments: args } = request.params;
        switch (name) {
          case "run_process":
            return this.handleRunProcess(args);
          case "get_cache_stats":
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(this.cache.stats(), null, 2),
                },
              ],
            };
          case "clear_command_cache":
            this.cache.clear();
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    message: "Cache cleared",
                  }),
                },
              ],
            };
          case "cached_commands": {
            const entries = this.cache.entries();
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    { total: entries.length, commands: entries },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
          case "execution_log": {
            const parsed = ExecutionLogArgs.parse(args ?? {});
            const entries = this.logger.read(parsed.limit, parsed.include_archives);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      total: parsed.limit,
                      include_archives: parsed.include_archives,
                      entries,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
          case "list_archives": {
            const archives = this.logger.listArchives();
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    { archives, count: archives.length },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
          case "resolve_uri":
            return this.handleResolveUri(args);
          case "write_file":
            return this.handleWriteFile(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      },
    );

    const uriConfigPath = expandHome("~/.config/uri-resolver/config.toml");
    if (existsSync(uriConfigPath)) {
      try {
        const uriConfig = parse(readFileSync(uriConfigPath, "utf-8"));
        const schemes = uriConfig.scheme as Array<{ name: string; path: string }> | undefined;
        if (schemes) {
          for (const s of schemes) {
            if (!this.roots.find((e) => e.scheme === s.name)) {
              const absolutePath = expandHome(s.path);
              if (existsSync(absolutePath)) {
                this.roots.push({
                  scheme: s.name,
                  path: s.path,
                  absolutePath,
                  source: "uri-resolver-config",
                });
              }
            }
          }
        }
      } catch {}
    }

    const raw = process.env.MCP_RESOURCE_ROOTS || "{}";

    let roots: Record<string, string> = {};
    try { roots = JSON.parse(raw) } catch { roots = {} }

    for (const [scheme, dir] of Object.entries(roots)) {
      if (!this.roots.find((e) => e.scheme === scheme)) {
        const absolutePath = expandHome(dir);
        if (existsSync(absolutePath)) {
          this.roots.push({
            scheme,
            path: dir,
            absolutePath,
            source: "MCP_RESOURCE_ROOTS",
          });
        }
      }
    }

    this.server.setRequestHandler(
      ListResourcesRequestSchema,
      () => ({ resources: [] }),
    );

    this.server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      () => ({
        resourceTemplates: this.roots.map(({ scheme, absolutePath }) => ({
          uriTemplate: `${scheme}://{path}`,
          name: `${scheme}:// resource`,
          description: `Access documents from ${absolutePath} by path (e.g. ${scheme}://path/to/file.md)`,
          mimeType: "text/markdown",
        })),
      }),
    );

    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const uri = request.params.uri;

        const matched = this.roots.find((r) =>
          uri.startsWith(`${r.scheme}://`)
        );
        if (!matched) {
          throw new Error(`Unsupported URI scheme: ${uri}`);
        }

        const filePath = path.join(matched.absolutePath, uri.slice(matched.scheme.length + 3));
        if (!filePath.startsWith(matched.absolutePath)) {
          throw new Error(`Path traversal denied: ${uri}`);
        }

        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${uri}`);
        }

        const content = readFileSync(filePath, "utf-8");
        return {
          contents: [
            {
              uri,
              mimeType: filePath.endsWith(".md")
                ? "text/markdown"
                : filePath.endsWith(".json")
                ? "application/json"
                : "text/plain",
              text: content,
            },
          ],
        };
      },
    );
  }

  private async handleRunProcess(
    args: Record<string, unknown> | undefined,
  ) {
    const parsed = RunProcessArgs.parse(args);

    const model =
      parsed.model_used ||
      process.env.RTK_MODEL_USED ||
      this.clientName ||
      "unknown";

    const useRtk = parsed.use_raw
      ? false
      : parsed.use_rtk_filter !== false;

    const { command: execCommand, rewritten } = tryRewrite(parsed.command, {
      useRtk,
      compact: parsed.rtk_compact ?? false,
    });
    const key = this.cache.hash(execCommand, parsed.cwd);
    const cached = this.cache.get(key);

    if (cached && !parsed.clear_cache) {
      this.cache.recordHit();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                cached: true,
                key,
                command: cached.raw_command || execCommand,
                result: cached.result,
                rtk_filtered: useRtk,
                rtk_rewritten: cached.rtk_rewritten,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    this.cache.recordMiss();
    const result = await executeCommand(execCommand, {
      timeout_ms: parsed.timeout_ms ?? this.config.timeout_ms,
      max_buffer_mb: this.config.max_buffer_mb,
      cwd: parsed.cwd,
    });

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      command: execCommand,
      raw_command: parsed.command,
      rtk_filtered: useRtk,
      rtk_rewritten: rewritten,
      model_used: model,
    });

    this.logger.append({
      timestamp: Date.now(),
      key,
      command: parsed.command,
      command_exec: execCommand,
      rtk_filtered: useRtk,
      rtk_rewritten: rewritten,
      cached: !!cached,
      success: result.success,
      exitCode: result.exitCode,
      duration_ms: result.duration_ms,
      model_used: model,
      error_type: categorizeError(
        result.exitCode,
        result.stderr,
        result.stdout,
      ),
      stdout: result.stdout,
      stderr: result.stderr,
      stdout_lines: result.stdout.split("\n").length,
      stderr_lines: result.stderr.split("\n").length,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              cached: false,
              key,
              command: parsed.command,
              result,
              rtk_filtered: useRtk,
              rtk_rewritten: rewritten,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  private handleResolveUri(
    args: Record<string, unknown> | undefined,
  ) {
    const { uri } = ResolveUriArgs.parse(args);
    const result = resolveUri(uri, this.roots);
    if (!result) {
      const schemes = listSchemes(this.roots)
        .map(s => s.scheme)
        .join(", ");
      throw new Error(`Unknown URI scheme: ${uri}. Supported: ${schemes}`);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  private async handleWriteFile(
    args: Record<string, unknown> | undefined,
  ) {
    const parsed = WriteFileArgs.parse(args);
    const { path: filePath, content_b64 } = parsed;

    const dir = path.dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const buffer = Buffer.from(content_b64, "base64");
    const content = buffer.toString("utf8");
    writeFileSync(filePath, content, "utf8");

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path: filePath,
              bytes_written: buffer.length,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("ServerCommandsRTK v0.2.0 running on stdio");
  }

  flush(): void {
    this.cache.flush();
  }
}
