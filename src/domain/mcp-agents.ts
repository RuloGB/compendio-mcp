import { join, win32 } from "node:path";

export type McpAgent = "claude" | "claude-desktop" | "cursor" | "vscode" | "opencode" | "codex";

export interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const VALID_AGENTS: McpAgent[] = ["claude", "claude-desktop", "cursor", "vscode", "opencode", "codex"];

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
    default:
      throw new Error(`Unknown MCP agent: "${agent}"`);
  }
}

export function getAgentServerKey(agent: McpAgent): string {
  return agent === "codex" ? "mcp_servers" : "mcpServers";
}

export function mergeMcpConfig(
  existing: Record<string, unknown>,
  serverName: string,
  entry: McpServerEntry,
  serverKey: string,
): Record<string, unknown> {
  const servers = (existing[serverKey] as Record<string, McpServerEntry> | undefined) ?? {};
  return {
    ...existing,
    [serverKey]: {
      ...servers,
      [serverName]: entry,
    },
  };
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
