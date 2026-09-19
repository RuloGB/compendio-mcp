import { describe, it, expect } from "vitest";
import { normalize, win32 } from "node:path";
import {
  getAgentConfigPath,
  getAgentServerKey,
  mergeMcpConfig,
  mergeCodexToml,
  type McpAgent,
  type McpServerEntry,
} from "../../src/domain/mcp-agents.js";

describe("mcp-agents", () => {
  const serverEntry: McpServerEntry = {
    command: "npx",
    args: ["-y", "compendio-mcp", "serve"],
  };

  describe("getAgentConfigPath", () => {
    it("returns correct path for claude on windows", () => {
      const home = "C:\\Users\\Test";
      const path = getAgentConfigPath("claude", "win32", home);
      expect(path).toBe(win32.join(home, ".claude", "settings.json"));
    });

    it("returns correct path for claude on linux", () => {
      const home = "/home/test";
      const path = getAgentConfigPath("claude", "linux", home);
      expect(path).toBe(normalize("/home/test/.claude/settings.json"));
    });

    it("returns correct path for claude-desktop on windows", () => {
      const home = "C:\\Users\\Test";
      const appData = "C:\\Users\\Test\\AppData\\Roaming";
      const path = getAgentConfigPath("claude-desktop", "win32", home, appData);
      expect(path).toBe(win32.join(appData, "Claude", "claude_desktop_config.json"));
    });

    it("returns correct path for claude-desktop on macos", () => {
      const home = "/Users/test";
      const path = getAgentConfigPath("claude-desktop", "darwin", home);
      expect(path).toBe(normalize("/Users/test/Library/Application Support/Claude/claude_desktop_config.json"));
    });

    it("returns correct path for cursor", () => {
      const home = "/home/test";
      const path = getAgentConfigPath("cursor", "linux", home);
      expect(path).toBe(normalize("/home/test/.cursor/mcp.json"));
    });

    it("returns correct path for vscode on windows", () => {
      const home = "C:\\Users\\Test";
      const appData = "C:\\Users\\Test\\AppData\\Roaming";
      const path = getAgentConfigPath("vscode", "win32", home, appData);
      expect(path).toBe(win32.join(appData, "Code", "User", "settings.json"));
    });

    it("returns correct path for opencode", () => {
      const home = "/home/test";
      const path = getAgentConfigPath("opencode", "linux", home);
      expect(path).toBe(normalize("/home/test/.config/opencode/opencode.json"));
    });

    it("returns correct path for codex", () => {
      const home = "/home/test";
      const path = getAgentConfigPath("codex", "linux", home);
      expect(path).toBe(normalize("/home/test/.codex/config.toml"));
    });

    it("returns correct path for zed on linux", () => {
      const home = "/home/test";
      const path = getAgentConfigPath("zed", "linux", home);
      expect(path).toBe(normalize("/home/test/.config/zed/settings.json"));
    });

    it("returns correct path for zed on windows", () => {
      const home = "C:\\Users\\Test";
      const appData = "C:\\Users\\Test\\AppData\\Roaming";
      const path = getAgentConfigPath("zed", "win32", home, appData);
      expect(path).toBe(win32.join(appData, "Zed", "settings.json"));
    });

    it("throws for unknown agent", () => {
      const home = "/home/test";
      expect(() => getAgentConfigPath("unknown" as McpAgent, "linux", home)).toThrow(
        'Unknown MCP agent: "unknown"'
      );
    });
  });

  describe("getAgentServerKey", () => {
    it("returns correct key for each agent", () => {
      expect(getAgentServerKey("claude")).toBe("mcpServers");
      expect(getAgentServerKey("claude-desktop")).toBe("mcpServers");
      expect(getAgentServerKey("cursor")).toBe("mcpServers");
      expect(getAgentServerKey("vscode")).toBe("servers");
      expect(getAgentServerKey("opencode")).toBe("mcp");
      expect(getAgentServerKey("codex")).toBe("mcp_servers");
      expect(getAgentServerKey("zed")).toBe("context_servers");
    });
  });

  describe("mergeMcpConfig", () => {
    it("adds new server to empty config for claude", () => {
      const existing = {};
      const result = mergeMcpConfig(existing, "compendio", serverEntry, "claude");
      expect(result).toEqual({
        mcpServers: {
          compendio: serverEntry,
        },
      });
    });

    it("adds new server alongside existing servers for cursor", () => {
      const existing = {
        mcpServers: {
          "other-server": { command: "other", args: [] },
        },
      };
      const result = mergeMcpConfig(existing, "compendio", serverEntry, "cursor");
      expect(result).toEqual({
        mcpServers: {
          "other-server": { command: "other", args: [] },
          compendio: serverEntry,
        },
      });
    });

    it("overwrites existing server with same name for claude-desktop", () => {
      const existing = {
        mcpServers: {
          compendio: { command: "old", args: ["old-args"] },
        },
      };
      const result = mergeMcpConfig(existing, "compendio", serverEntry, "claude-desktop");
      expect(result).toEqual({
        mcpServers: {
          compendio: serverEntry,
        },
      });
    });

    it("preserves other config keys for claude", () => {
      const existing = {
        someOtherKey: "value",
        mcpServers: {
          existing: { command: "existing" },
        },
      };
      const result = mergeMcpConfig(existing, "compendio", serverEntry, "claude");
      expect(result).toEqual({
        someOtherKey: "value",
        mcpServers: {
          existing: { command: "existing" },
          compendio: serverEntry,
        },
      });
    });

    it("handles config without server key for claude", () => {
      const existing = { someOtherKey: "value" };
      const result = mergeMcpConfig(existing, "compendio", serverEntry, "claude");
      expect(result).toEqual({
        someOtherKey: "value",
        mcpServers: {
          compendio: serverEntry,
        },
      });
    });

    it("transforms entry to OpenCode format", () => {
      const existing = {};
      const result = mergeMcpConfig(existing, "compendio", serverEntry, "opencode");
      expect(result).toEqual({
        mcp: {
          compendio: {
            type: "local",
            command: ["npx", "-y", "compendio-mcp", "serve"],
            enabled: true,
          },
        },
      });
    });

    it("adds OpenCode server alongside existing servers", () => {
      const existing = {
        mcp: {
          codegraph: { command: ["codegraph"], type: "local" },
        },
      };
      const result = mergeMcpConfig(existing, "compendio", serverEntry, "opencode");
      expect(result).toEqual({
        mcp: {
          codegraph: { command: ["codegraph"], type: "local" },
          compendio: {
            type: "local",
            command: ["npx", "-y", "compendio-mcp", "serve"],
            enabled: true,
          },
        },
      });
    });

    it("transforms entry to VS Code format", () => {
      const existing = {};
      const result = mergeMcpConfig(existing, "compendio", serverEntry, "vscode");
      expect(result).toEqual({
        servers: {
          compendio: {
            type: "stdio",
            command: "npx",
            args: ["-y", "compendio-mcp", "serve"],
          },
        },
      });
    });

    it("transforms entry to Zed format", () => {
      const existing = {};
      const result = mergeMcpConfig(existing, "compendio", serverEntry, "zed");
      expect(result).toEqual({
        context_servers: {
          compendio: {
            command: "npx",
            args: ["-y", "compendio-mcp", "serve"],
            env: {},
          },
        },
      });
    });

    it("preserves env in Zed format when provided", () => {
      const entryWithEnv: McpServerEntry = {
        command: "npx",
        args: ["-y", "compendio-mcp", "serve"],
        env: { API_KEY: "test" },
      };
      const existing = {};
      const result = mergeMcpConfig(existing, "compendio", entryWithEnv, "zed");
      expect(result).toEqual({
        context_servers: {
          compendio: {
            command: "npx",
            args: ["-y", "compendio-mcp", "serve"],
            env: { API_KEY: "test" },
          },
        },
      });
    });
  });

  describe("mergeCodexToml", () => {
    const serverEntry: McpServerEntry = {
      command: "npx",
      args: ["-y", "compendio-mcp", "serve"],
    };

    it("adds new server to empty config", () => {
      const existing = {};
      const result = mergeCodexToml(existing, "compendio", serverEntry);
      expect(result).toEqual({
        mcp_servers: {
          compendio: {
            command: "npx",
            args: ["-y", "compendio-mcp", "serve"],
            enabled: true,
            startup_timeout_sec: 60,
          },
        },
      });
    });

    it("adds new server alongside existing servers", () => {
      const existing = {
        mcp_servers: {
          "other-server": { command: "other", args: ["--flag"] },
        },
      };
      const result = mergeCodexToml(existing, "compendio", serverEntry);
      expect(result).toEqual({
        mcp_servers: {
          "other-server": { command: "other", args: ["--flag"] },
          compendio: {
            command: "npx",
            args: ["-y", "compendio-mcp", "serve"],
            enabled: true,
            startup_timeout_sec: 60,
          },
        },
      });
    });

    it("overwrites existing server with same name", () => {
      const existing = {
        mcp_servers: {
          compendio: { command: "old", args: ["old-args"] },
        },
      };
      const result = mergeCodexToml(existing, "compendio", serverEntry);
      expect(result).toEqual({
        mcp_servers: {
          compendio: {
            command: "npx",
            args: ["-y", "compendio-mcp", "serve"],
            enabled: true,
            startup_timeout_sec: 60,
          },
        },
      });
    });

    it("preserves other config keys", () => {
      const existing = {
        someOtherKey: "value",
        mcp_servers: {
          existing: { command: "existing" },
        },
      };
      const result = mergeCodexToml(existing, "compendio", serverEntry);
      expect(result).toEqual({
        someOtherKey: "value",
        mcp_servers: {
          existing: { command: "existing" },
          compendio: {
            command: "npx",
            args: ["-y", "compendio-mcp", "serve"],
            enabled: true,
            startup_timeout_sec: 60,
          },
        },
      });
    });
  });
});
