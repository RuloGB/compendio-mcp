import type { DiscoverResult, DocumentFile, DocumentSource, EncodingNotice, ReadError } from "../../domain/ports.js";

/** One already-built per-root `DocumentSource` plus its identity, so a
 * failure can be reported and messages can name the offending root. */
export interface RootSource {
  /** Exactly as written in config or `--dir`, for messages. */
  declared: string;
  /** Absolute, for messages. */
  dir: string;
  /** The alias this source emits; also its `ReadError.path` when it fails
   * (see design.md Decision 4 — implemented in PR 3, not here). */
  prefix: string;
  source: DocumentSource;
}

/**
 * Fans out to N per-root `DocumentSource`s, merges their results, and
 * re-sorts by `path` — preserving `FileDocumentSource`'s sorted-output
 * contract. Runs for a one-element root set too: there is no `multi` flag
 * and no shortcut, so the single most common configuration takes the same
 * code path the multi-root tests exercise (design.md Decision 3).
 *
 * PR 2 scope: no per-root tolerance yet. A root that fails to read
 * propagates immediately, exactly as today's single `FileDocumentSource`
 * does — the composite's per-root `try`/`catch` and all-fail rethrow land in
 * PR 3 (design.md Decision 2, "Rationale" point 1).
 */
export class CompositeDocumentSource implements DocumentSource {
  constructor(private readonly roots: RootSource[]) {}

  async discover(): Promise<DiscoverResult> {
    const files: DocumentFile[] = [];
    const readErrors: ReadError[] = [];
    const encodingNotices: EncodingNotice[] = [];

    for (const root of this.roots) {
      // Sequential, not Promise.allSettled: discovery is not this project's
      // measured bottleneck, and sequential keeps failure attribution
      // order-independent (design.md Decision 3, "Why sequential").
      const result = await root.source.discover();
      files.push(...result.files);
      readErrors.push(...result.readErrors);
      encodingNotices.push(...(result.encodingNotices ?? []));
    }

    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, readErrors, encodingNotices };
  }
}
