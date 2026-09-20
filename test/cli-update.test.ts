import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: (...args: Parameters<typeof spawnMock>) => spawnMock(...args),
}));

const { runNpmUpdate } = await import("../src/cli.js");

function fakeChild(): EventEmitter & { stdout: null; stderr: null } {
  const child = new EventEmitter() as EventEmitter & { stdout: null; stderr: null };
  child.stdout = null;
  child.stderr = null;
  return child;
}

describe("runNpmUpdate", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    spawnMock.mockReset();
  });

  it("spawns npm with the correct arguments and stdio inherit", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runNpmUpdate();
    child.emit("close", 0);
    await promise;

    const expectedCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    expect(spawnMock).toHaveBeenCalledWith(
      expectedCommand,
      ["install", "-g", "compendio-mcp@latest"],
      { stdio: "inherit", shell: true },
    );
  });

  it("prints the success message on exit code 0", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runNpmUpdate();
    child.emit("close", 0);
    await promise;

    expect(logSpy).toHaveBeenCalledWith("compendio updated to the latest version.");
    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("prints the error message and exits with code 1 on non-zero exit", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runNpmUpdate();
    child.emit("close", 1);
    await promise;

    expect(errorSpy).toHaveBeenCalledWith("Error: failed to update compendio.");
    expect(errorSpy).toHaveBeenCalledWith("npm exited with code 1");
    expect(logSpy).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("prints the error message and exits with code 1 when spawn emits an error", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runNpmUpdate();
    child.emit("error", new Error("ENOENT"));
    await promise;

    expect(errorSpy).toHaveBeenCalledWith("Error: failed to update compendio.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("uses npm.cmd on Windows and npm elsewhere", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runNpmUpdate();
    child.emit("close", 0);
    await promise;

    const calledWith = spawnMock.mock.calls[0]?.[0];
    if (process.platform === "win32") {
      expect(calledWith).toBe("npm.cmd");
    } else {
      expect(calledWith).toBe("npm");
    }
  });
});
