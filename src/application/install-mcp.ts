import { dirname } from "node:path";
import { mergeMcpConfig, mergeCodexToml, type McpServerEntry } from "../domain/mcp-agents.js";
import { parseToml, serializeToml } from "../infrastructure/config/toml.js";

export interface InstallMcpDependencies {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface InstallMcpOptions {
  agent: string;
  configPath: string;
  serverName: string;
  serverEntry: McpServerEntry;
  serverKey: string;
}

export interface InstallMcpResult {
  configPath: string;
  created: boolean;
  overwritten: boolean;
}

export class InstallMcp {
  constructor(private readonly deps: InstallMcpDependencies) {}

  async execute(options: InstallMcpOptions): Promise<InstallMcpResult> {
    const { agent, configPath, serverName, serverEntry, serverKey } = options;
    const isCodex = agent === "codex";

    let existing: Record<string, unknown> = {};
    let created = false;

    try {
      const content = await this.deps.readFile(configPath);
      if (isCodex) {
        existing = parseToml(content);
      } else {
        existing = JSON.parse(content);
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") throw error;
      created = true;
      await this.deps.mkdir(dirname(configPath));
    }

    const overwritten = existing[serverKey] !== undefined && 
      (existing[serverKey] as Record<string, unknown>)[serverName] !== undefined;

    let content: string;
    if (isCodex) {
      const merged = mergeCodexToml(existing, serverName, serverEntry);
      content = serializeToml(merged);
    } else {
      const merged = mergeMcpConfig(existing, serverName, serverEntry, serverKey);
      content = JSON.stringify(merged, null, 2);
    }

    await this.deps.writeFile(configPath, content);

    return {
      configPath,
      created,
      overwritten,
    };
  }
}
