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

export interface CompositeDocumentSourceOptions {
  /** Explicit mode tolerates partial root failure so remaining declared roots
   * can still index and the failed alias protects stale rows from deletion.
   * Discovery mode sets this to true because every discovered root was selected
   * by a fail-closed scan, so any later root failure aborts the whole sync
   * before healthy roots can mutate the index. */
  failOnRootError?: boolean;
}

/**
 * Fans out to N per-root `DocumentSource`s, merges their results, and
 * re-sorts by `path` — preserving `FileDocumentSource`'s sorted-output
 * contract. Runs for a one-element root set too: there is no `multi` flag
 * and no shortcut, so the single most common configuration takes the same
 * code path the multi-root tests exercise (design.md Decision 3).
 *
 * Per-root tolerance (design.md Decisions 2-4): by default, a root whose `discover()`
 * rejects is converted into one `ReadError` — `path` is the root's ALIAS,
 * `error` names the declared root string and its absolute dir for humans —
 * and the pass continues over the remaining roots. Only when EVERY root
 * fails does `discover()` itself reject, with one aggregate message naming
 * every declared root and its reason (the same "nothing to index is a
 * configuration error" semantics as today's single root, generalized to N —
 * for a one-element root set, "one root fails" and "every root fails" are
 * the same event, so the pre-existing always-throws behaviour holds
 * unmodified). With `failOnRootError`, used by discovery mode, any root
 * failure rejects the pass because discovery has no user-declared partial
 * root set to tolerate.
 */
export class CompositeDocumentSource implements DocumentSource {
  constructor(
    private readonly roots: RootSource[],
    private readonly options: CompositeDocumentSourceOptions = {},
  ) {}

  async discover(): Promise<DiscoverResult> {
    const files: DocumentFile[] = [];
    const readErrors: ReadError[] = [];
    const encodingNotices: EncodingNotice[] = [];
    const failures: RootFailure[] = [];
    if (this.roots.length === 0) return { files, readErrors, encodingNotices };

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

    if (failures.length === this.roots.length || (this.options.failOnRootError === true && failures.length > 0)) {
      const detail = failures.map(({ root, reason }) => `"${root.declared}" (${root.dir}): ${reason}`).join("; ");
      const prefix = failures.length === this.roots.length
        ? "no documentation root could be read"
        : "one or more documentation roots could not be read";
      throw new Error(`${prefix}: ${detail}`);
    }

    files.sort((a, b) => a.path.localeCompare(b.path));
    return { files, readErrors, encodingNotices };
  }
}
