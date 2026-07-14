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
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { SchemeEntry } from "./resolver.js";
import { expandHome, resolveUri, listSchemes } from "./resolver.js";
import {
  RunProcessArgs,
  ExecutionLogArgs,
  WriteFileArgs,
  ResolveUriArgs,
  ReadFileArgs,
} from "./schemas.js";
import type { ServerConfig } from "./schemas.js";
import { loadConfig } from "./config.js";
import { parse } from "smol-toml";
import { CommandCache } from "./cache.js";
import { ExecutionLogger } from "./logger.js";
import { executeCommand } from "./executor.js";
import { categorizeError } from "./errors.js";
import { analyzeFile } from "@ev3lynx/md-analyzer";

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
            "Run shell command. Auto-prefixed with `rtk` for token minimization (60-90% savings).",
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
          {
            name: "read_file",
            description:
              "Read a file with token-optimized output via `rtk read`. First-class read tool mirroring write_file. Supports max_lines, tail_lines, level (none|minimal|aggressive), line_numbers, and analyze (md-analyzer structure for .md files).",
            inputSchema: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description: "Absolute path to the file to read",
                },
                max_lines: {
                  type: "number",
                  description: "Max lines to return",
                },
                tail_lines: {
                  type: "number",
                  description: "Keep only last N lines",
                },
                level: {
                  type: "string",
                  enum: ["none", "minimal", "aggressive"],
                  description: "Filter level (default none = full content)",
                },
                line_numbers: {
                  type: "boolean",
                  description: "Show line numbers",
                },
                analyze: {
                  type: "boolean",
                  description: "Run md-analyzer on .md files; includes headings, links, tokens, and stats in structuredContent",
                },
              },
              required: ["path"],
            },
            annotations: { readOnlyHint: true },
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
          case "read_file":
            return this.handleReadFile(args);
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

    const key = this.cache.hash(parsed.command, parsed.cwd);
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
                result: cached.result,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    this.cache.recordMiss();
    const result = await executeCommand(parsed.command, {
      timeout_ms: parsed.timeout_ms ?? this.config.timeout_ms,
      max_buffer_mb: this.config.max_buffer_mb,
      cwd: parsed.cwd,
    });

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      command: parsed.command,
      model_used: model,
    });

    this.logger.append({
      timestamp: Date.now(),
      key,
      command: parsed.command,
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
              result,
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

  private async handleReadFile(
    args: Record<string, unknown> | undefined,
  ) {
    const parsed = ReadFileArgs.parse(args);
    const { path: filePath, max_lines, tail_lines, level, line_numbers, analyze } = parsed;

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    if (!statSync(filePath).isFile()) {
      throw new Error(`Not a file: ${filePath}`);
    }

    let cmd = `rtk read ${JSON.stringify(filePath)}`;
    if (max_lines) cmd += ` --max-lines ${max_lines}`;
    if (tail_lines) cmd += ` --tail-lines ${tail_lines}`;
    if (level !== "none") cmd += ` --level ${level}`;
    if (line_numbers) cmd += ` --line-numbers`;

    const result = await executeCommand(cmd, {
      timeout_ms: this.config.timeout_ms,
      max_buffer_mb: this.config.max_buffer_mb,
      cwd: undefined,
    });

    if (!result.success) {
      throw new Error(`read failed: ${result.stderr || result.stdout}`);
    }

    const content = result.stdout;
    const response: Record<string, unknown> = {
      path: filePath,
      content,
      truncated: !!max_lines || !!tail_lines,
      lines: content.split("\n").length,
    };
    if (analyze && filePath.endsWith(".md")) {
      try {
        response.analysis = analyzeFile(filePath);
      } catch (e: unknown) {
        response.analysis_error = e instanceof Error ? e.message : String(e);
      }
    }
    return {
      content: [
        {
          type: "text",
          text: content,
        },
      ],
      structuredContent: response,
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
