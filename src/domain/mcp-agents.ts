import { join, win32 } from "node:path";

export type McpAgent = "claude" | "claude-desktop" | "cursor" | "vscode" | "opencode" | "codex" | "zed";

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const VALID_AGENTS: McpAgent[] = ["claude", "claude-desktop", "cursor", "vscode", "opencode", "codex", "zed"];

export function isValidAgent(value: string): value is McpAgent {
  return VALID_AGENTS.includes(value as McpAgent);
}

function joinPath(platform: NodeJS.Platform, ...segments: string[]): string {
  return platform === "win32" ? win32.join(...segments) : join(...segments);
}

export function getAgentConfigPath(
  agent: McpAgent,
  platform: NodeJS.Platform,
  homeDir: string,
  appDataDir?: string,
): string {
  switch (agent) {
    case "claude":
      return joinPath(platform, homeDir, ".claude", "settings.json");
    case "claude-desktop":
      if (platform === "win32") {
        if (!appDataDir) throw new Error("APPDATA required for claude-desktop on Windows");
        return joinPath(platform, appDataDir, "Claude", "claude_desktop_config.json");
      }
      if (platform === "darwin") {
        return joinPath(platform, homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      }
      return joinPath(platform, homeDir, ".config", "Claude", "claude_desktop_config.json");
    case "cursor":
      return joinPath(platform, homeDir, ".cursor", "mcp.json");
    case "vscode":
      if (platform === "win32") {
        if (!appDataDir) throw new Error("APPDATA required for vscode on Windows");
        return joinPath(platform, appDataDir, "Code", "User", "settings.json");
      }
      if (platform === "darwin") {
        return joinPath(platform, homeDir, "Library", "Application Support", "Code", "User", "settings.json");
      }
      return joinPath(platform, homeDir, ".config", "Code", "User", "settings.json");
    case "opencode":
      return joinPath(platform, homeDir, ".config", "opencode", "opencode.json");
    case "codex":
      return joinPath(platform, homeDir, ".codex", "config.toml");
    case "zed":
      if (platform === "win32") {
        if (!appDataDir) throw new Error("APPDATA required for zed on Windows");
        return joinPath(platform, appDataDir, "Zed", "settings.json");
      }
      if (platform === "darwin") {
        return joinPath(platform, homeDir, "Library", "Application Support", "Zed", "settings.json");
      }
      return joinPath(platform, homeDir, ".config", "zed", "settings.json");
    default:
      throw new Error(`Unknown MCP agent: "${agent}"`);
  }
}

export function getAgentServerKey(agent: McpAgent): string {
  switch (agent) {
    case "vscode":
      return "servers";
    case "opencode":
      return "mcp";
    case "zed":
      return "context_servers";
    case "codex":
      return "mcp_servers";
    default:
      return "mcpServers";
  }
}

export function mergeMcpConfig(
  existing: Record<string, unknown>,
  serverName: string,
  entry: McpServerEntry,
  agent: McpAgent,
): Record<string, unknown> {
  const serverKey = getAgentServerKey(agent);
  const servers = (existing[serverKey] as Record<string, unknown> | undefined) ?? {};
  const serverValue = transformServerEntry(entry, agent);
  
  return {
    ...existing,
    [serverKey]: {
      ...servers,
      [serverName]: serverValue,
    },
  };
}

function transformServerEntry(entry: McpServerEntry, agent: McpAgent): unknown {
  switch (agent) {
    case "opencode":
      return {
        type: "local",
        command: [entry.command, ...entry.args],
        enabled: true,
      };
    case "vscode":
      return {
        type: "stdio",
        command: entry.command,
        args: entry.args,
      };
    case "zed":
      return {
        command: entry.command,
        args: entry.args,
        env: entry.env ?? {},
      };
    default:
      return entry;
  }
}

export function mergeCodexToml(
  existing: Record<string, unknown>,
  serverName: string,
  entry: McpServerEntry,
): Record<string, unknown> {
  const servers = (existing["mcp_servers"] as Record<string, unknown> | undefined) ?? {};
  return {
    ...existing,
    mcp_servers: {
      ...servers,
      [serverName]: {
        command: entry.command,
        args: entry.args,
        enabled: true,
        startup_timeout_sec: 60,
      },
    },
  };
}
