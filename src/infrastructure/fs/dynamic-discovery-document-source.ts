import type { DiscoverResult, DocumentSource, IndexStore } from "../../domain/ports.js";
import { type ResolvedRoot, resolveRoots } from "../config.js";
import { CompositeDocumentSource, type RootSource } from "./composite-document-source.js";
import {
  type DiscoveredMarkdownRoot,
  discoverMarkdownRootDetails,
  validateDiscoveredRootAlias,
} from "./discover-markdown-roots.js";
import { FileDocumentSource, type FileDocumentSourceOptions } from "./file-document-source.js";

export class DynamicDiscoveryDocumentSource implements DocumentSource {
  constructor(
    private readonly projectRoot: string,
    private readonly exclude: string[],
    private readonly indexedDocuments: Pick<IndexStore, "listDocuments">,
    private readonly rootPrefixes: string[],
  ) {}

  async discover(): Promise<DiscoverResult> {
    const discoveredRoots = discoverMarkdownRootDetails(this.projectRoot);
    const selectedByAlias = new Map(discoveredRoots.map((root) => [root.declared, root]));

    for (const alias of this.indexedRootAliases()) {
      if (!selectedByAlias.has(alias)) {
        selectedByAlias.set(alias, validateDiscoveredRootAlias(this.projectRoot, alias));
      }
    }

    const selectedRoots = [...selectedByAlias.values()].sort((a, b) =>
      a.declared < b.declared ? -1 : a.declared > b.declared ? 1 : 0,
    );
    const roots = selectedRoots.length === 0
      ? []
      : resolveRoots(this.projectRoot, selectedRoots.map((root) => root.declared));
    this.replaceRootPrefixes(roots.map((root) => root.prefix));

    const trustedByAlias = new Map(selectedRoots.map((root) => [root.declared, root.trustedRealPath]));
    return new CompositeDocumentSource(
      roots.map((root) => toRootSource(root, this.exclude, trustedByAlias)),
      { failOnRootError: true },
    ).discover();
  }

  private indexedRootAliases(): string[] {
    const aliases = new Set<string>();
    for (const doc of this.indexedDocuments.listDocuments()) {
      const slash = doc.path.indexOf("/");
      if (slash > 0) aliases.add(doc.path.slice(0, slash));
    }
    return [...aliases].sort((a, b) => a.localeCompare(b));
  }

  private replaceRootPrefixes(prefixes: string[]): void {
    this.rootPrefixes.splice(0, this.rootPrefixes.length, ...prefixes);
  }
}

function toRootSource(
  root: ResolvedRoot,
  exclude: string[],
  trustedByAlias: Map<string, DiscoveredMarkdownRoot["trustedRealPath"]>,
): RootSource {
  return {
    ...root,
    source: new FileDocumentSource(
      root.dir,
      exclude,
      root.prefix,
      discoveryOptions(trustedByAlias.get(root.declared)),
    ),
  };
}

function discoveryOptions(trustedRootRealPath: string | undefined): FileDocumentSourceOptions {
  return trustedRootRealPath === undefined
    ? { discoveryMode: true }
    : { discoveryMode: true, trustedRootRealPath };
}
