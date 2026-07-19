import matter from "gray-matter";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Heading, Node, Paragraph, Root } from "mdast";
import type { DocOutline, DocSection } from "../../domain/outline.js";
import type { MarkdownParser, ParsedMarkdown } from "../../domain/ports.js";

interface HeadingEvent {
  depth: number;
  titulo: string;
  /** Offset of the heading line within the body. */
  start: number;
  /** Offset right after the heading line. */
  end: number;
}

/**
 * Markdown adapter: gray-matter extracts the frontmatter, remark provides the
 * heading positions, and sections are sliced from the raw body so chunks keep
 * the original formatting byte for byte.
 */
export class RemarkMarkdownParser implements MarkdownParser {
  private readonly processor = unified().use(remarkParse);

  parse(raw: string): ParsedMarkdown {
    const { data, content } = matter(raw);
    const tree = this.processor.parse(content) as Root;

    const headings: HeadingEvent[] = [];
    let titulo = "";
    let resumen = "";
    let h1End = 0;
    let seenH1 = false;

    for (const node of tree.children) {
      if (node.type === "heading") {
        const heading = node as Heading;
        const event: HeadingEvent = {
          depth: heading.depth,
          titulo: textOf(heading),
          start: heading.position?.start.offset ?? 0,
          end: heading.position?.end.offset ?? 0,
        };
        if (heading.depth === 1 && !seenH1) {
          seenH1 = true;
          titulo = event.titulo;
          h1End = event.end;
        } else if (heading.depth >= 2 && heading.depth <= 3) {
          headings.push(event);
        }
      } else if (node.type === "paragraph" && seenH1 && resumen === "") {
        resumen = textOf(node as Paragraph);
      }
    }

    const outline = buildOutline(content, { titulo, resumen, h1End, headings });
    return { data: data as Record<string, unknown>, outline, body: content };
  }
}

function buildOutline(
  body: string,
  parsed: { titulo: string; resumen: string; h1End: number; headings: HeadingEvent[] },
): DocOutline {
  const { headings } = parsed;
  const firstH2 = headings.find((h) => h.depth === 2);
  const introEnd = firstH2?.start ?? body.length;
  const intro = body.slice(parsed.h1End, introEnd).trim();

  const secciones: DocSection[] = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]!;
    if (heading.depth !== 2) continue;

    const sectionEnd = nextIndexWithDepth(headings, i + 1, 2) ?? body.length;
    const children: DocSection[] = [];
    let ownEnd = sectionEnd;

    for (let j = i + 1; j < headings.length; j++) {
      const sub = headings[j]!;
      if (sub.start >= sectionEnd) break;
      if (sub.depth !== 3) continue;
      if (ownEnd === sectionEnd) ownEnd = sub.start;
      const subEnd = nextBoundary(headings, j + 1, sectionEnd);
      children.push({
        titulo: sub.titulo,
        texto: body.slice(sub.start, subEnd).trim(),
        children: [],
      });
    }

    secciones.push({
      titulo: heading.titulo,
      texto: body.slice(heading.start, ownEnd).trim(),
      children,
    });
  }

  return { titulo: parsed.titulo, resumen: parsed.resumen, intro, secciones };
}

/** Offset where the next heading of the given depth starts, from `from`. */
function nextIndexWithDepth(headings: HeadingEvent[], from: number, depth: number): number | null {
  for (let i = from; i < headings.length; i++) {
    if (headings[i]!.depth === depth) return headings[i]!.start;
  }
  return null;
}

/** Offset of the next H2/H3 heading, bounded by the enclosing section end. */
function nextBoundary(headings: HeadingEvent[], from: number, sectionEnd: number): number {
  for (let i = from; i < headings.length; i++) {
    const heading = headings[i]!;
    if (heading.start >= sectionEnd) break;
    if (heading.depth <= 3) return heading.start;
  }
  return sectionEnd;
}

function textOf(node: Node): string {
  if ("value" in node && typeof (node as { value?: unknown }).value === "string") {
    return (node as { value: string }).value;
  }
  if ("children" in node && Array.isArray((node as { children?: unknown }).children)) {
    return (node as { children: Node[] }).children.map((child) => textOf(child)).join("");
  }
  return "";
}
