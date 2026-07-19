/**
 * Structural view of a markdown document, produced by the markdown parser
 * adapter and consumed by the pure chunking policy.
 */

/** An H2 or H3 section. `texto` is the raw markdown slice including its own
 * heading line but excluding child sections. */
export interface DocSection {
  titulo: string;
  texto: string;
  children: DocSection[];
}

export interface DocOutline {
  /** H1 title. */
  titulo: string;
  /** First paragraph after the H1 (document summary per the convention). */
  resumen: string;
  /** Raw markdown between the H1 line and the first H2 (excludes the H1 line). */
  intro: string;
  /** H2-level sections, each with its H3 children. Deeper headings stay inline. */
  secciones: DocSection[];
}
