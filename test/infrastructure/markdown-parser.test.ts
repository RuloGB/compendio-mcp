import { describe, expect, it } from "vitest";
import { RemarkMarkdownParser } from "../../src/infrastructure/markdown/remark-markdown-parser";

const SAMPLE = `---
tipo: funcional
modulo: leadsviewer
estado: vigente
etiquetas: [lead, validacion]
---

# Validación del formulario

Resumen del documento en un párrafo que se sostiene solo.

Texto adicional de introducción.

## Contexto y objetivo

Contexto de la funcionalidad.

## Reglas de negocio

Intro de las reglas.

### Campos

| Campo | Regla |
|---|---|
| Email | obligatorio |

#### Detalle anidado

Texto bajo un H4 que no abre sección nueva.

### Duplicidad

Un lead se considera duplicado por email.

## Referencias

Enlaces.
`;

describe("RemarkMarkdownParser", () => {
  const parser = new RemarkMarkdownParser();

  it("extracts frontmatter, H1 title and summary paragraph", () => {
    const parsed = parser.parse(SAMPLE);
    expect(parsed.data["tipo"]).toBe("funcional");
    expect(parsed.data["etiquetas"]).toEqual(["lead", "validacion"]);
    expect(parsed.outline.title).toBe("Validación del formulario");
    expect(parsed.outline.summary).toBe("Resumen del documento en un párrafo que se sostiene solo.");
  });

  it("captures the intro between the H1 and the first H2, without the H1 line", () => {
    const { outline } = parser.parse(SAMPLE);
    expect(outline.intro).toContain("Resumen del documento");
    expect(outline.intro).toContain("Texto adicional");
    expect(outline.intro).not.toContain("# Validación");
    expect(outline.intro).not.toContain("## Contexto");
  });

  it("builds H2 sections with their H3 children, slices including heading lines", () => {
    const { outline } = parser.parse(SAMPLE);
    expect(outline.sections.map((s) => s.title)).toEqual([
      "Contexto y objetivo",
      "Reglas de negocio",
      "Referencias",
    ]);
    const reglas = outline.sections[1]!;
    expect(reglas.text.startsWith("## Reglas de negocio")).toBe(true);
    expect(reglas.text).toContain("Intro de las reglas.");
    expect(reglas.text).not.toContain("### Campos");
    expect(reglas.children.map((c) => c.title)).toEqual(["Campos", "Duplicidad"]);
    expect(reglas.children[0]!.text.startsWith("### Campos")).toBe(true);
  });

  it("keeps H4+ headings inline inside their enclosing section", () => {
    const { outline } = parser.parse(SAMPLE);
    const campos = outline.sections[1]!.children[0]!;
    expect(campos.text).toContain("#### Detalle anidado");
    expect(campos.text).toContain("| Email | obligatorio |");
  });

  it("handles a document without sections", () => {
    const { outline } = parser.parse("# Solo título\n\nUn único párrafo.\n");
    expect(outline.title).toBe("Solo título");
    expect(outline.sections).toEqual([]);
    expect(outline.intro).toBe("Un único párrafo.");
  });
});
