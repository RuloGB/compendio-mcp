import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Estado } from "../domain/model.js";

export interface CompendioConfig {
  docsDir: string;
  exclude: string[];
  db: string;
  embeddings: {
    provider: "local";
    model: string;
  };
  chunk: {
    minTokens: number;
    maxTokens: number;
  };
  search: {
    k: number;
    estadosExcluidos: Estado[];
  };
}

export const CONFIG_FILE = "compendio.config.json";

/** Files indexed as a single chunk (no heading-based chunking). */
export const SIN_CHUNKING = ["glosario.md"];

export const DEFAULT_CONFIG: CompendioConfig = {
  docsDir: "docs",
  exclude: ["INDEX.md"],
  db: ".compendio/compendio.db",
  embeddings: { provider: "local", model: "Xenova/multilingual-e5-small" },
  chunk: { minTokens: 100, maxTokens: 800 },
  search: { k: 5, estadosExcluidos: ["borrador", "obsoleto"] },
};

/**
 * Loads compendio.config.json from the project root, merged over defaults.
 * Every key has a default: in a repo following the convention the tool works
 * with no config file at all.
 */
export function loadConfig(root: string): CompendioConfig {
  let raw: string;
  try {
    raw = readFileSync(join(root, CONFIG_FILE), "utf8");
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${CONFIG_FILE} no es JSON valido: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return mergeConfig(structuredClone(DEFAULT_CONFIG), parsed as Partial<CompendioConfig>);
}

function mergeConfig(base: CompendioConfig, override: Partial<CompendioConfig>): CompendioConfig {
  return {
    docsDir: override.docsDir ?? base.docsDir,
    exclude: override.exclude ?? base.exclude,
    db: override.db ?? base.db,
    embeddings: { ...base.embeddings, ...override.embeddings },
    chunk: { ...base.chunk, ...override.chunk },
    search: { ...base.search, ...override.search },
  };
}
