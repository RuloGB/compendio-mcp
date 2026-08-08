import type { DiscoverResult, DocumentFile, DocumentSource, EncodingNotice, ReadError } from "../../domain/ports.js";

/** One already-built per-root `DocumentSource` plus its identity, so a
 * failure can be reported and messages can name the offending root. */
export interface RootSource {
  /** Exactly as written in config or `--dir`, for messages. */
  declared: string;
  /** Absolute, for messages. */
  dir: string;
  /** The alias this source emits; also its `ReadError.path` when it fails —
   * NEVER `declared`, because `SyncIndex`'s subtree-protection match
   * (`sync-index.ts`'s `isProtected`) operates on the alias-prefixed `path`
   * shape every persisted document uses (design.md Decision 4). */
  prefix: string;
  source: DocumentSource;
}

/** One root's `discover()` rejection, captured for the all-fail rethrow. */
interface RootFailure {
  root: RootSource;
  reason: string;
}

/**
 * Fans out to N per-root `DocumentSource`s, merges their results, and
 * re-sorts by `path` — preserving `FileDocumentSource`'s sorted-output
 * contract. Runs for a one-element root set too: there is no `multi` flag
 * and no shortcut, so the single most common configuration takes the same
 * code path the multi-root tests exercise (design.md Decision 3).
 *
 * Per-root tolerance (design.md Decisions 2-4): a root whose `discover()`
 * rejects is converted into one `ReadError` — `path` is the root's ALIAS,
 * `error` names the declared root string and its absolute dir for humans —
 * and the pass continues over the remaining roots. Only when EVERY root
 * fails does `discover()` itself reject, with one aggregate message naming
 * every declared root and its reason (the same "nothing to index is a
 * configuration error" semantics as today's single root, generalized to N —
 * for a one-element root set, "one root fails" and "every root fails" are
 * the same event, so the pre-existing always-throws behaviour holds
 * unmodified).
 */
export class CompositeDocumentSource implements DocumentSource {
  constructor(private readonly roots: RootSource[]) {}

  async discover(): Promise<DiscoverResult> {
    const files: DocumentFile[] = [];
    const readErrors: ReadError[] = [];
    const encodingNotices: EncodingNotice[] = [];
    const failures: RootFailure[] = [];

    for (const root of this.roots) {
      // Sequential, not Promise.allSettled: discovery is not this project's
      // measured bottleneck, and sequential keeps failure attribution
      // order-independent (design.md Decision 3, "Why sequential").
      try {
        const result = await root.source.discover();
        files.push(...result.files);
        readErrors.push(...result.readErrors);
        encodingNotices.push(...(result.encodingNotices ?? []));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failures.push({ root, reason });
        readErrors.push({
          path: root.prefix,
          error: `declared documentation root "${root.declared}" (${root.dir}) could not be read: ${reason}`,
        });
      }
    }

    if (failures.length === this.roots.length) {
      const detail = failures.map(({ root, reason }) => `"${root.declared}" (${root.dir}): ${reason}`).join("; ");
      throw new Error(`no documentation root could be read: ${detail}`);
    }

    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, readErrors, encodingNotices };
  }
}
