/**
 * Structural view of a markdown document, produced by the markdown parser
 * adapter and consumed by the pure chunking policy.
 */

/** An H2 or H3 section. `text` is the raw markdown slice including its own
 * heading line but excluding child sections. */
export interface DocSection {
  title: string;
  text: string;
  children: DocSection[];
}

export interface DocOutline {
  /** H1 title. */
  title: string;
  /** First paragraph after the H1 (document summary per the convention). */
  summary: string;
  /** Raw markdown between the H1 line and the first H2 (excludes the H1 line). */
  intro: string;
  /** H2-level sections, each with its H3 children. Deeper headings stay inline. */
  sections: DocSection[];
}
