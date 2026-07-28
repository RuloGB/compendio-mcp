import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransformersEmbeddings } from "../../src/infrastructure/embeddings/transformers-embeddings";

const pipelineMock = vi.fn();

// `vi.mock` calls are hoisted above imports by vitest's transform, so the
// static import above already resolves against this mock.
vi.mock("@huggingface/transformers", () => ({
  pipeline: (...args: unknown[]) => pipelineMock(...args),
}));

const FAKE_EXTRACTOR = () => {
  throw new Error("not called in these tests");
};

beforeEach(() => {
  pipelineMock.mockReset();
});

describe("TransformersEmbeddings.create — progress_callback gating (Trap 1)", () => {
  it("passes no progress_callback on the q8 pipeline() call when no options are given", async () => {
    pipelineMock.mockResolvedValueOnce(FAKE_EXTRACTOR);
    await TransformersEmbeddings.create("Xenova/model");

    expect(pipelineMock).toHaveBeenCalledTimes(1);
    const q8Options = pipelineMock.mock.calls[0]![2] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(q8Options, "progress_callback")).toBe(false);
  });

  it("passes progress_callback as a function on the q8 call when onDownloadProgress is given", async () => {
    pipelineMock.mockResolvedValueOnce(FAKE_EXTRACTOR);
    await TransformersEmbeddings.create("Xenova/model", { onDownloadProgress: () => {} });

    expect(pipelineMock).toHaveBeenCalledTimes(1);
    const q8Options = pipelineMock.mock.calls[0]![2] as Record<string, unknown>;
    expect(typeof q8Options["progress_callback"]).toBe("function");
  });

  it("Trap 2: also passes progress_callback on the fallback call when the q8 call rejects", async () => {
    pipelineMock.mockRejectedValueOnce(new Error("q8 dtype unsupported"));
    pipelineMock.mockResolvedValueOnce(FAKE_EXTRACTOR);
    await TransformersEmbeddings.create("Xenova/model", { onDownloadProgress: () => {} });

    expect(pipelineMock).toHaveBeenCalledTimes(2);
    // The fallback call today passes no options object at all — the easy one to miss.
    const fallbackOptions = pipelineMock.mock.calls[1]![2] as Record<string, unknown> | undefined;
    expect(fallbackOptions).toBeDefined();
    expect(typeof fallbackOptions!["progress_callback"]).toBe("function");
  });
});

describe("TransformersEmbeddings.create — download progress mapping", () => {
  it("maps a progress_total status to { loaded, total } for the caller", async () => {
    pipelineMock.mockResolvedValueOnce(FAKE_EXTRACTOR);
    const onDownloadProgress = vi.fn();
    await TransformersEmbeddings.create("Xenova/model", { onDownloadProgress });

    const q8Options = pipelineMock.mock.calls[0]![2] as Record<string, unknown>;
    const callback = q8Options["progress_callback"] as (info: unknown) => void;
    callback({ status: "progress_total", loaded: 42, total: 100 });

    expect(onDownloadProgress).toHaveBeenCalledExactlyOnceWith({ loaded: 42, total: 100 });
  });

  it("ignores progress, initiate, done, and ready statuses", async () => {
    pipelineMock.mockResolvedValueOnce(FAKE_EXTRACTOR);
    const onDownloadProgress = vi.fn();
    await TransformersEmbeddings.create("Xenova/model", { onDownloadProgress });

    const q8Options = pipelineMock.mock.calls[0]![2] as Record<string, unknown>;
    const callback = q8Options["progress_callback"] as (info: unknown) => void;
    for (const status of ["progress", "initiate", "done", "ready"]) {
      callback({ status, loaded: 1, total: 1 });
    }

    expect(onDownloadProgress).not.toHaveBeenCalled();
  });
});
