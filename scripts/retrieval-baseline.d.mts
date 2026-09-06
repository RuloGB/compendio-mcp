/**
 * Type declarations for `retrieval-baseline.mjs`'s testable exports, co-located
 * with the script as `retrieval-baseline.d.mts` — the `.d.mts` extension is
 * required, not `.d.ts`, because TypeScript's Node-ESM module resolution
 * matches a `.mjs` source file's sibling declaration by that exact suffix.
 * An ambient `declare module "../scripts/retrieval-baseline.mjs"` inside
 * `test/` does NOT work here: a relative specifier is resolved against the
 * real file first, so the ambient declaration is never consulted.
 * The script itself stays plain, untyped Node ESM, matching every other
 * `scripts/*.mjs` in this repository (AGENTS.md: "There is no lint script
 * configured"); this file exists solely so `tsconfig.test.json` — which DOES
 * see `test/` — can typecheck `test/retrieval-baseline.test.ts`.
 */

export class SecurityError extends Error {}

export function resolveCanonicalRoot(rootPath: string): string;
export function assertContained(candidatePath: string, canonicalRoot: string, label?: string): void;
export function isMarkdownPath(path: string): boolean;
export function assertOutputAvailable(outputPath: string): void;
export function assertWalAbsentOrEmpty(dbPath: string): void;
export function sha256Bytes(buffer: Buffer): string;
export function sha256File(path: string): string;
export function combineFileHashes(hashes: readonly string[]): string;
export function verifyUnchanged(before: string, after: string, label: string): void;
export function assertModelPrerequisites(modelDir: string): void;
export function computeLogicalDigest(store: unknown): string;
