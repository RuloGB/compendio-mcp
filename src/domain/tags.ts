/**
 * The canonical form of a tag in this system: trimmed, lowercased, empties
 * dropped. Both sides of every tag comparison MUST use this — `resolveTags`
 * normalizes what a document declares at index time, `buildFilters`
 * normalizes what a caller asks for at query time, and the comparison is
 * exact string equality in SQL (`je.value IN (…)`). Two copies of this rule
 * is precisely the defect this function exists to make unrepeatable: before
 * it, the write side trimmed and the read side did not, so a stored `api`
 * could not be found by a query for ` api`.
 */
export function normalizeTags(values: readonly string[]): string[] {
  return values.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0);
}
