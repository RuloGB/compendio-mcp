import { describe, it, expect } from "vitest";
import { InstallMcp } from "../../src/application/install-mcp.js";
import type { McpServerEntry } from "../../src/domain/mcp-agents.js";

interface FakeFsState {
  files: Map<string, string>;
}

function createFakeFs(state: FakeFsState) {
  return {
    async readFile(path: string): Promise<string> {
      const content = state.files.get(path);
      if (content === undefined) {
        const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
      }
      return content;
    },
    async writeFile(path: string, content: string): Promise<void> {
      state.files.set(path, content);
    },
    async mkdir(path: string): Promise<void> {
      // no-op for fake
    },
  };
}

describe("InstallMcp", () => {
  const serverEntry: McpServerEntry = {
    command: "npx",
    args: ["-y", "compendio-mcp", "serve"],
  };

  it("creates new config file when it does not exist", async () => {
    const state: FakeFsState = { files: new Map() };
    const fakeFs = createFakeFs(state);
    const useCase = new InstallMcp(fakeFs);

    const result = await useCase.execute({
      agent: "claude",
      configPath: "/home/test/.claude/settings.json",
      serverName: "compendio",
      serverEntry,
    });

    expect(result.created).toBe(true);
    expect(result.overwritten).toBe(false);
    expect(result.configPath).toBe("/home/test/.claude/settings.json");

    const written = state.files.get("/home/test/.claude/settings.json");
    expect(written).toBeDefined();
    const parsed = JSON.parse(written!);
    expect(parsed.mcpServers.compendio).toEqual(serverEntry);
  });

  it("adds server to existing config", async () => {
    const existing = {
      mcpServers: {
        "other-server": { command: "other", args: ["--flag"] },
      },
      someOtherKey: "value",
    };
    const state: FakeFsState = {
      files: new Map([["/home/test/.claude/settings.json", JSON.stringify(existing, null, 2)]]),
    };
    const fakeFs = createFakeFs(state);
    const useCase = new InstallMcp(fakeFs);

    const result = await useCase.execute({
      agent: "claude",
      configPath: "/home/test/.claude/settings.json",
      serverName: "compendio",
      serverEntry,
    });

    expect(result.created).toBe(false);
    expect(result.overwritten).toBe(false);

    const written = state.files.get("/home/test/.claude/settings.json");
    const parsed = JSON.parse(written!);
    expect(parsed.mcpServers.compendio).toEqual(serverEntry);
    expect(parsed.mcpServers["other-server"]).toEqual({ command: "other", args: ["--flag"] });
    expect(parsed.someOtherKey).toBe("value");
  });

  it("overwrites existing server with same name", async () => {
    const existing = {
      mcpServers: {
        compendio: { command: "old", args: ["old-args"] },
      },
    };
    const state: FakeFsState = {
      files: new Map([["/home/test/.claude/settings.json", JSON.stringify(existing, null, 2)]]),
    };
    const fakeFs = createFakeFs(state);
    const useCase = new InstallMcp(fakeFs);

    const result = await useCase.execute({
      agent: "claude",
      configPath: "/home/test/.claude/settings.json",
      serverName: "compendio",
      serverEntry,
    });

    expect(result.created).toBe(false);
    expect(result.overwritten).toBe(true);

    const written = state.files.get("/home/test/.claude/settings.json");
    const parsed = JSON.parse(written!);
    expect(parsed.mcpServers.compendio).toEqual(serverEntry);
  });

  it("handles empty config file", async () => {
    const state: FakeFsState = {
      files: new Map([["/home/test/.claude/settings.json", "{}"]]),
    };
    const fakeFs = createFakeFs(state);
    const useCase = new InstallMcp(fakeFs);

    const result = await useCase.execute({
      agent: "claude",
      configPath: "/home/test/.claude/settings.json",
      serverName: "compendio",
      serverEntry,
    });

    expect(result.created).toBe(false);
    expect(result.overwritten).toBe(false);

    const written = state.files.get("/home/test/.claude/settings.json");
    const parsed = JSON.parse(written!);
    expect(parsed.mcpServers.compendio).toEqual(serverEntry);
  });

  it("creates parent directories if they do not exist", async () => {
    const state: FakeFsState = { files: new Map() };
    const fakeFs = createFakeFs(state);
    const useCase = new InstallMcp(fakeFs);

    const result = await useCase.execute({
      agent: "claude",
      configPath: "/home/test/.claude/settings.json",
      serverName: "compendio",
      serverEntry,
    });

    expect(result.created).toBe(true);
    expect(state.files.has("/home/test/.claude/settings.json")).toBe(true);
  });

  it("creates TOML config for codex agent", async () => {
    const state: FakeFsState = { files: new Map() };
    const fakeFs = createFakeFs(state);
    const useCase = new InstallMcp(fakeFs);

    const result = await useCase.execute({
      agent: "codex",
      configPath: "/home/test/.codex/config.toml",
      serverName: "compendio",
      serverEntry,
    });

    expect(result.created).toBe(true);
    const written = state.files.get("/home/test/.codex/config.toml");
    expect(written).toBeDefined();
    expect(written).toContain("[mcp_servers.compendio]");
    expect(written).toContain('command = "npx"');
    expect(written).toContain('args = ["-y", "compendio-mcp", "serve"]');
    expect(written).toContain("enabled = true");
    expect(written).toContain("startup_timeout_sec = 60");
  });

  it("adds server to existing TOML config", async () => {
    const existingToml = `[mcp_servers.other-server]
command = "other"
args = ["--flag"]
`;
    const state: FakeFsState = {
      files: new Map([["/home/test/.codex/config.toml", existingToml]]),
    };
    const fakeFs = createFakeFs(state);
    const useCase = new InstallMcp(fakeFs);

    const result = await useCase.execute({
      agent: "codex",
      configPath: "/home/test/.codex/config.toml",
      serverName: "compendio",
      serverEntry,
    });

    expect(result.created).toBe(false);
    const written = state.files.get("/home/test/.codex/config.toml");
    expect(written).toContain("[mcp_servers.other-server]");
    expect(written).toContain("[mcp_servers.compendio]");
    expect(written).toContain('command = "npx"');
  });

  it("creates OpenCode format config", async () => {
    const state: FakeFsState = { files: new Map() };
    const fakeFs = createFakeFs(state);
    const useCase = new InstallMcp(fakeFs);

    const result = await useCase.execute({
      agent: "opencode",
      configPath: "/home/test/.config/opencode/opencode.json",
      serverName: "compendio",
      serverEntry,
    });

    expect(result.created).toBe(true);
    const written = state.files.get("/home/test/.config/opencode/opencode.json");
    const parsed = JSON.parse(written!);
    expect(parsed.mcp.compendio).toEqual({
      type: "local",
      command: ["npx", "-y", "compendio-mcp", "serve"],
      enabled: true,
    });
  });

  it("creates VS Code format config", async () => {
    const state: FakeFsState = { files: new Map() };
    const fakeFs = createFakeFs(state);
    const useCase = new InstallMcp(fakeFs);

    const result = await useCase.execute({
      agent: "vscode",
      configPath: "/home/test/.config/Code/User/settings.json",
      serverName: "compendio",
      serverEntry,
    });

    expect(result.created).toBe(true);
    const written = state.files.get("/home/test/.config/Code/User/settings.json");
    const parsed = JSON.parse(written!);
    expect(parsed.servers.compendio).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "compendio-mcp", "serve"],
    });
  });

  it("creates Zed format config", async () => {
    const state: FakeFsState = { files: new Map() };
    const fakeFs = createFakeFs(state);
    const useCase = new InstallMcp(fakeFs);

    const result = await useCase.execute({
      agent: "zed",
      configPath: "/home/test/.config/zed/settings.json",
      serverName: "compendio",
      serverEntry,
    });

    expect(result.created).toBe(true);
    const written = state.files.get("/home/test/.config/zed/settings.json");
    const parsed = JSON.parse(written!);
    expect(parsed.context_servers.compendio).toEqual({
      command: "npx",
      args: ["-y", "compendio-mcp", "serve"],
      env: {},
    });
  });
});
