/**
 * Simple TOML parser/serializer for Codex MCP config format.
 * Handles only the subset needed for MCP server configuration.
 */

export interface TomlServerEntry {
  command: string;
  args: string[];
  enabled?: boolean;
  startup_timeout_sec?: number;
}

export interface TomlConfig {
  mcp_servers?: Record<string, TomlServerEntry>;
  [key: string]: unknown;
}

/**
 * Parses a simple TOML file with [mcp_servers.name] sections.
 * Only handles the subset needed for Codex MCP config.
 */
export function parseToml(content: string): TomlConfig {
  const result: TomlConfig = {};
  let currentSection: string | null = null;
  let currentServer: string | null = null;

  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    // Section header: [mcp_servers.name]
    const sectionMatch = trimmed.match(/^\[mcp_servers\.([^\]]+)\]$/);
    if (sectionMatch && sectionMatch[1]) {
      currentSection = "mcp_servers";
      currentServer = sectionMatch[1];
      if (!result.mcp_servers) {
        result.mcp_servers = {};
      }
      if (!result.mcp_servers[currentServer]) {
        result.mcp_servers[currentServer] = { command: "", args: [] };
      }
      continue;
    }

    // Other section headers (not mcp_servers)
    const otherSectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (otherSectionMatch && otherSectionMatch[1]) {
      currentSection = otherSectionMatch[1];
      currentServer = null;
      continue;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^([^=]+)=\s*(.+)$/);
    if (kvMatch && kvMatch[1] && kvMatch[2] && currentSection && currentServer) {
      const key = kvMatch[1].trim();
      const value = parseTomlValue(kvMatch[2].trim());

      if (currentSection === "mcp_servers" && result.mcp_servers?.[currentServer]) {
        const server = result.mcp_servers[currentServer];
        if (server) {
          if (key === "command" && typeof value === "string") {
            server.command = value;
          } else if (key === "args" && Array.isArray(value)) {
            server.args = value as string[];
          } else if (key === "enabled" && typeof value === "boolean") {
            server.enabled = value;
          } else if (key === "startup_timeout_sec" && typeof value === "number") {
            server.startup_timeout_sec = value;
          }
        }
      }
    }
  }

  return result;
}

function parseTomlValue(value: string): unknown {
  // String: "value"
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  // Array: ["a", "b", "c"]
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => parseTomlValue(item.trim()));
  }

  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Number
  const num = Number(value);
  if (!isNaN(num)) return num;

  // Fallback: return as string
  return value;
}

/**
 * Serializes a TOML config to string format.
 * Only handles the subset needed for Codex MCP config.
 */
export function serializeToml(config: TomlConfig): string {
  const lines: string[] = [];

  // Serialize mcp_servers sections
  if (config.mcp_servers) {
    for (const [name, server] of Object.entries(config.mcp_servers)) {
      lines.push(`[mcp_servers.${name}]`);
      lines.push(`command = "${escapeTomlString(server.command)}"`);
      lines.push(`args = [${server.args.map((arg) => `"${escapeTomlString(arg)}"`).join(", ")}]`);
      if (server.enabled !== undefined) {
        lines.push(`enabled = ${server.enabled}`);
      }
      if (server.startup_timeout_sec !== undefined) {
        lines.push(`startup_timeout_sec = ${server.startup_timeout_sec}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
