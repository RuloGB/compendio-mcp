import type { DocumentMeta, SearchFilters } from "./model.js";

/** Distinct filterable values actually present in the indexed corpus. */
export interface CorpusFacets {
  types: string[];
  modules: string[];
  tags: string[];
  statuses: string[];
}

const MAX_LISTED_VALUES = 12;

/** Collects the distinct values a project's documents actually declare. */
export function collectFacets(documents: readonly DocumentMeta[]): CorpusFacets {
  const types = new Set<string>();
  const modules = new Set<string>();
  const tags = new Set<string>();
  const statuses = new Set<string>();
  for (const doc of documents) {
    if (doc.type !== undefined) types.add(doc.type);
    if (doc.module !== undefined) modules.add(doc.module);
    if (doc.status !== undefined) statuses.add(doc.status);
    for (const tag of doc.tags) tags.add(tag.toLowerCase());
  }
  return {
    types: [...types].sort(),
    modules: [...modules].sort(),
    tags: [...tags].sort(),
    statuses: [...statuses].sort(),
  };
}

/**
 * Strips filters that no document in the corpus could ever satisfy, because
 * the field they target is declared by nothing at all.
 *
 * This is deliberately narrower than "the filter matched nothing". A filter on
 * a *declared* field with an unknown value stays: the caller asked something
 * answerable and gets an empty result plus the list of real values, so it can
 * correct itself. A filter on a field no document declares is not a failed
 * query, it is a malformed one — usually an agent inferring a taxonomy from
 * directory names against a project whose frontmatter keys were never mapped.
 *
 * Honouring it produces a guaranteed zero, and a zero is measurably the worst
 * thing to hand back: observed agents read it as "search harder", escalating k
 * and re-querying rather than dropping the filter they were told to drop.
 * Ignoring it while saying so loudly costs one call instead of three and hides
 * nothing — the caller is told the filter was dropped and why.
 */
export function dropImpossibleFilters(
  filters: SearchFilters,
  facets: CorpusFacets,
): { filters: SearchFilters; droppedFields: string[] } {
  const kept: SearchFilters = { ...filters };
  const droppedFields: string[] = [];

  if (kept.type !== undefined && facets.types.length === 0) {
    delete kept.type;
    droppedFields.push("type");
  }
  if (kept.module !== undefined && facets.modules.length === 0) {
    delete kept.module;
    droppedFields.push("module");
  }
  if (kept.tags !== undefined && kept.tags.length > 0 && facets.tags.length === 0) {
    delete kept.tags;
    droppedFields.push("tags");
  }
  return { filters: kept, droppedFields };
}

/** Explains, for the caller, which filters were dropped and what to fix. */
export function describeDroppedFilters(droppedFields: readonly string[]): string {
  const fields = list(droppedFields);
  const plural = droppedFields.length > 1;
  return (
    `Ignored the ${fields} filter${plural ? "s" : ""}: no document in this project declares ` +
    `${plural ? "those fields" : "that field"}, so ${plural ? "they" : "it"} could never match. ` +
    `Results below are unfiltered. If you expected ${fields} to work, the project needs ` +
    `convention.frontmatterFields to map its frontmatter keys.`
  );
}

/**
 * Explains an empty result when a filter is the likely cause.
 *
 * A bare `results: []` is the worst answer compendio can give: it reads as a
 * fact about the corpus ("this project documents nothing about that") when it
 * is usually a fact about the request or the project's config. The common case
 * is an agent inferring a taxonomy from directory names — filtering
 * `type: "uc"` because `docs/uc/` exists — against a project whose frontmatter
 * keys were never mapped, so every document's `type` is absent and the filter
 * can never match anything.
 *
 * Returns undefined when no filter was applied: a plain lexical/semantic miss
 * needs no explanation, and inventing one would be noise on every empty query.
 */
export function explainEmptyResult(
  filters: SearchFilters,
  facets: CorpusFacets,
): string | undefined {
  const reasons: string[] = [];

  const type = filters.type;
  if (type !== undefined) {
    if (facets.types.length === 0) {
      reasons.push(
        `no document in this project declares a "type", so filtering by type can never ` +
          `match — retry without it`,
      );
    } else if (!facets.types.includes(type)) {
      reasons.push(`no document has type "${type}" (declared: ${list(facets.types)})`);
    }
  }

  const module = filters.module;
  if (module !== undefined) {
    if (facets.modules.length === 0) {
      reasons.push(
        `no document in this project declares a "module", so filtering by module can never ` +
          `match — retry without it`,
      );
    } else if (!facets.modules.includes(module)) {
      reasons.push(`no document has module "${module}" (declared: ${list(facets.modules)})`);
    }
  }

  const tags = filters.tags;
  if (tags !== undefined && tags.length > 0) {
    if (facets.tags.length === 0) {
      reasons.push(
        `no document in this project declares tags, so filtering by tags can never match — ` +
          `retry without them`,
      );
    } else {
      const unknown = tags.filter((tag) => !facets.tags.includes(tag.toLowerCase()));
      if (unknown.length === tags.length) {
        reasons.push(`no document carries ${list(unknown)} (declared: ${list(facets.tags)})`);
      }
    }
  }

  // The status deny-list comes from the project's own config, not from the
  // request, so an agent has no way to guess it is what emptied the result.
  // Only worth raising when the corpus actually holds a denied status.
  const excluded = filters.excludedStatuses ?? [];
  const activeExclusions = excluded.filter((status) => facets.statuses.includes(status));
  if (activeExclusions.length > 0) {
    reasons.push(
      `this project excludes documents with status ${list(activeExclusions)} by convention — ` +
        `set include_excluded to search them too`,
    );
  }

  if (reasons.length > 0) return `${reasons.join("; ")}.`;

  // Every filter is individually valid, so the combination — or the query
  // itself — is what emptied the result. Still worth saying: the agent needs to
  // know dropping a filter is the next move, not rephrasing forever.
  if (hasAnyFilter(filters)) {
    return "every filter used is valid on its own, so their combination matched no document — retry with fewer filters.";
  }
  return undefined;
}

function hasAnyFilter(filters: SearchFilters): boolean {
  return (
    filters.type !== undefined ||
    filters.module !== undefined ||
    (filters.tags !== undefined && filters.tags.length > 0)
  );
}

/** Renders values as a quoted, comma-separated list, truncated when long. */
function list(values: readonly string[]): string {
  const shown = values.slice(0, MAX_LISTED_VALUES).map((value) => `"${value}"`);
  const rest = values.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}
