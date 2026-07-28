import type { EmbeddingsProvider } from "../../domain/ports.js";

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

/** Aggregate download progress across every file the model needs. */
export interface DownloadProgress {
  loaded: number;
  total: number;
}

export interface TransformersEmbeddingsOptions {
  /** Called on each aggregate `progress_total` update. Never called for
   * per-file `progress`, `initiate`, `done`, or `ready` status updates. */
  onDownloadProgress?: (progress: DownloadProgress) => void;
}

/** Shape `transformers.js`'s `DefaultProgressCallback` invokes its callback with. */
interface TransformersProgressInfo {
  status: string;
  loaded?: number;
  total?: number;
}

/**
 * Local embeddings via transformers.js (ONNX on CPU). The model is downloaded
 * on first use and cached on disk by the library; after that, operation is
 * fully offline. Any load failure must be handled by the caller (degraded
 * lexical mode), never crash the server.
 */
export class TransformersEmbeddings implements EmbeddingsProvider {
  private constructor(private readonly extractor: FeatureExtractor) {}

  static async create(
    model: string,
    options?: TransformersEmbeddingsOptions,
  ): Promise<TransformersEmbeddings> {
    const { pipeline } = await import("@huggingface/transformers");
    const onDownloadProgress = options?.onDownloadProgress;
    // `pipeline()` issues a `get_file_metadata` request per model file only
    // when `progress_callback` is truthy — gating on `undefined` (never
    // spreading) keeps every call path with no `onProgress` byte-identical
    // to today (Trap 1). Built once so the exact same function reference is
    // reused on the fallback call (Trap 2).
    const progressCallback =
      onDownloadProgress === undefined
        ? undefined
        : (info: TransformersProgressInfo) => {
            if (info.status !== "progress_total") return;
            onDownloadProgress({ loaded: info.loaded ?? 0, total: info.total ?? 0 });
          };

    let extractor: unknown;
    try {
      // q8 weights: ~4x smaller download, near-identical retrieval quality.
      extractor =
        progressCallback === undefined
          ? await pipeline("feature-extraction", model, { dtype: "q8" })
          : await pipeline("feature-extraction", model, { dtype: "q8", progress_callback: progressCallback });
    } catch {
      // The fallback needs the same progress_callback — it is a full second
      // download attempt, not a cheap retry (Trap 2: easy to miss because
      // this call took no options object at all before this change).
      extractor =
        progressCallback === undefined
          ? await pipeline("feature-extraction", model)
          : await pipeline("feature-extraction", model, { progress_callback: progressCallback });
    }
    return new TransformersEmbeddings(extractor as FeatureExtractor);
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const output = await this.extractor(texts, { pooling: "mean", normalize: true });
    const [rows, dim] = [output.dims[0] ?? 0, output.dims[output.dims.length - 1] ?? 0];
    if (rows !== texts.length || dim === 0) {
      throw new Error(`unexpected embeddings output (dims: ${output.dims.join("x")})`);
    }
    const data =
      output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
    const vectors: Float32Array[] = [];
    for (let i = 0; i < rows; i++) {
      vectors.push(data.slice(i * dim, (i + 1) * dim));
    }
    return vectors;
  }
}

/**
 * Defers loading the real provider until the first embed call, so the MCP
 * server starts instantly. A load failure is remembered and rethrown: use
 * cases interpret it as "switch to lexical mode".
 */
export class LazyEmbeddings implements EmbeddingsProvider {
  private provider: EmbeddingsProvider | null = null;
  private failure: Error | null = null;

  constructor(private readonly factory: () => Promise<EmbeddingsProvider>) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.failure !== null) throw this.failure;
    if (this.provider === null) {
      try {
        this.provider = await this.factory();
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error));
        throw this.failure;
      }
    }
    return this.provider.embed(texts);
  }
}
