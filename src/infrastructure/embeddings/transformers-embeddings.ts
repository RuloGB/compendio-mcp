import type { EmbeddingsProvider } from "../../domain/ports.js";

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

/**
 * Local embeddings via transformers.js (ONNX on CPU). The model is downloaded
 * on first use and cached on disk by the library; after that, operation is
 * fully offline. Any load failure must be handled by the caller (degraded
 * lexical mode), never crash the server.
 */
export class TransformersEmbeddings implements EmbeddingsProvider {
  private constructor(private readonly extractor: FeatureExtractor) {}

  static async create(model: string): Promise<TransformersEmbeddings> {
    const { pipeline } = await import("@huggingface/transformers");
    let extractor: unknown;
    try {
      // q8 weights: ~4x smaller download, near-identical retrieval quality.
      extractor = await pipeline("feature-extraction", model, { dtype: "q8" });
    } catch {
      extractor = await pipeline("feature-extraction", model);
    }
    return new TransformersEmbeddings(extractor as FeatureExtractor);
  }

  async embed(textos: string[]): Promise<Float32Array[]> {
    if (textos.length === 0) return [];
    const output = await this.extractor(textos, { pooling: "mean", normalize: true });
    const [rows, dim] = [output.dims[0] ?? 0, output.dims[output.dims.length - 1] ?? 0];
    if (rows !== textos.length || dim === 0) {
      throw new Error(`salida de embeddings inesperada (dims: ${output.dims.join("x")})`);
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

  async embed(textos: string[]): Promise<Float32Array[]> {
    if (this.failure !== null) throw this.failure;
    if (this.provider === null) {
      try {
        this.provider = await this.factory();
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error));
        throw this.failure;
      }
    }
    return this.provider.embed(textos);
  }
}
