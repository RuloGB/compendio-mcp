import { describe, expect, it } from "vitest";
import { chunkOutline } from "../../src/domain/chunking";
import type { DocOutline, DocSection } from "../../src/domain/outline";

// minTokens 25 = 100 chars; maxTokens 100 = 400 chars (4 chars per token).
const OPTS = { minTokens: 25, maxTokens: 100 };

function section(titulo: string, chars: number, children: DocSection[] = []): DocSection {
  return { titulo, texto: `## ${titulo}\n\n${"x".repeat(chars)}`, children };
}

function outline(secciones: DocSection[], intro = ""): DocOutline {
  return { titulo: "Doc de prueba", resumen: "Resumen.", intro, secciones };
}

describe("chunkOutline", () => {
  it("creates one chunk per H2 section when sizes are within limits", () => {
    const chunks = chunkOutline(outline([section("Contexto", 200), section("Reglas", 250)]), OPTS);
    expect(chunks.map((c) => c.encabezado)).toEqual(["Contexto", "Reglas"]);
    expect(chunks[0]!.contenido).toContain("## Contexto");
    expect(chunks.map((c) => c.orden)).toEqual([0, 1]);
  });

  it("emits the intro (text between H1 and first H2) under the document title", () => {
    const chunks = chunkOutline(
      outline([section("Contexto", 200)], "Párrafo de resumen con contexto suficiente."),
      OPTS,
    );
    expect(chunks[0]!.encabezado).toBe("Doc de prueba");
    expect(chunks[0]!.contenido).toContain("Párrafo de resumen");
  });

  it("splits an oversized H2 into its H3 children with full heading paths", () => {
    const big = section("Reglas de negocio", 0, [
      { titulo: "Campos", texto: `### Campos\n\n${"a".repeat(300)}`, children: [] },
      { titulo: "Duplicidad", texto: `### Duplicidad\n\n${"b".repeat(300)}`, children: [] },
    ]);
    big.texto = `## Reglas de negocio\n\n${"i".repeat(150)}`;
    const chunks = chunkOutline(outline([big]), OPTS);
    expect(chunks.map((c) => c.encabezado)).toEqual([
      "Reglas de negocio",
      "Reglas de negocio > Campos",
      "Reglas de negocio > Duplicidad",
    ]);
  });

  it("keeps an H2 whole when it fits, even if it has H3 children", () => {
    const parent = section("Reglas", 0, [
      { titulo: "Campos", texto: "### Campos\n\ncorto", children: [] },
    ]);
    parent.texto = "## Reglas\n\nintro breve";
    const chunks = chunkOutline(outline([parent]), OPTS);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.contenido).toContain("### Campos");
  });

  it("merges tiny contiguous sections into the previous chunk", () => {
    const chunks = chunkOutline(
      outline([section("Contexto", 200), section("Referencias", 20), section("Notas", 20)]),
      OPTS,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.encabezado).toBe("Contexto");
    expect(chunks[0]!.contenido).toContain("## Referencias");
    expect(chunks[0]!.contenido).toContain("## Notas");
  });

  it("does not merge when the combination would exceed maxTokens", () => {
    const chunks = chunkOutline(outline([section("Grande", 390), section("Mini", 20)]), OPTS);
    expect(chunks).toHaveLength(2);
  });

  it("keeps a section with a huge table whole (tables are never split)", () => {
    const table = `## Tabla\n\n| a | b |\n|---|---|\n${"| dato | dato |\n".repeat(60)}`;
    const chunks = chunkOutline(
      outline([{ titulo: "Tabla", texto: table, children: [] }]),
      OPTS,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.contenido).toBe(table);
  });
});
