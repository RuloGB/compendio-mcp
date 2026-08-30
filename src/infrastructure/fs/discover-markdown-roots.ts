import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { isSameOrInsideRealPath } from "./path-containment.js";

const DISCOVERY_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".compendio",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

export function isDiscoveryIgnoredDirectory(name: string): boolean {
  return DISCOVERY_IGNORED_DIRECTORY_NAMES.has(name.toLowerCase());
}

export interface DiscoveredMarkdownRoot {
  declared: string;
  trustedRealPath: string;
}

export function discoverMarkdownRootDetails(projectRoot: string): DiscoveredMarkdownRoot[] {
  const projectRealPath = realpathSync(projectRoot);
  const entries = readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !isDiscoveryIgnoredDirectory(entry.name))
    .sort((a, b) => compareRaw(a.name, b.name));

  const roots: DiscoveredMarkdownRoot[] = [];
  for (const entry of entries) {
    const candidate = join(projectRoot, entry.name);
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
    const candidateRealPath = realpathSync(candidate);
    if (!isSameOrInsideRealPath(projectRealPath, candidateRealPath)) continue;
    if (containsMarkdown(candidate, candidateRealPath)) {
      roots.push({ declared: entry.name, trustedRealPath: candidateRealPath });
    }
  }
  return roots;
}

export function discoverMarkdownRoots(projectRoot: string): string[] {
  return discoverMarkdownRootDetails(projectRoot).map((root) => root.declared);
}

export function validateDiscoveredRootAlias(projectRoot: string, alias: string): DiscoveredMarkdownRoot {
  const projectRealPath = realpathSync(projectRoot);
  const candidate = join(projectRoot, alias);
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch (error) {
    throw new Error(`previously discovered documentation root "${alias}" could not be inspected: ${describeError(error)}`);
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`previously discovered documentation root "${alias}" is now a symlink or junction`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`previously discovered documentation root "${alias}" is not a directory`);
  }
  let candidateRealPath: string;
  try {
    candidateRealPath = realpathSync(candidate);
  } catch (error) {
    throw new Error(`previously discovered documentation root "${alias}" could not be resolved: ${describeError(error)}`);
  }
  if (!isSameOrInsideRealPath(projectRealPath, candidateRealPath)) {
    throw new Error(`previously discovered documentation root "${alias}" resolves outside the project root`);
  }
  return { declared: alias, trustedRealPath: candidateRealPath };
}

function containsMarkdown(dir: string, rootRealPath: string): boolean {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => compareRaw(a.name, b.name));
  let foundMarkdown = false;
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) continue;
    const entryRealPath = realpathSync(absolute);
    if (!isSameOrInsideRealPath(rootRealPath, entryRealPath)) continue;
    if (stat.isDirectory()) {
      if (isDiscoveryIgnoredDirectory(entry.name)) continue;
      if (containsMarkdown(absolute, rootRealPath)) foundMarkdown = true;
      continue;
    }
    if (stat.isFile() && entry.name.toLowerCase().endsWith(".md")) foundMarkdown = true;
  }
  return foundMarkdown;
}

function compareRaw(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
