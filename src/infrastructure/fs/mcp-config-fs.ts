import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { InstallMcpDependencies } from "../../application/install-mcp.js";

export function createFsAdapter(): InstallMcpDependencies {
  return {
    async readFile(path: string): Promise<string> {
      return readFile(path, "utf-8");
    },
    async writeFile(path: string, content: string): Promise<void> {
      await writeFile(path, content, "utf-8");
    },
    async mkdir(path: string): Promise<void> {
      await mkdir(path, { recursive: true });
    },
  };
}
