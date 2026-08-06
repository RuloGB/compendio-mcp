/**
 * Generates a synthetic documentation corpus that reproduces the chunking
 * pathology `bounded-chunk-size` exists to fix, without using anyone's real
 * documents.
 *
 * The shape it reproduces, measured from a private 38-document corpus:
 *
 * | Property                        | Target  |
 * | ------------------------------- | ------- |
 * | Documents                       | 38      |
 * | Chunks (at maxTokens 800)       | 242     |
 * | Chunks above 800 tokens         | 5       |
 * | Largest single chunk            | ~41 837 |
 * | Tokens held by oversized chunks | ~50 302 |
 *
 * The load-bearing property is that the largest documents carry **no markdown
 * headings at all** — they are Word exports — so `chunkOutline` has nothing to
 * split on and the whole body lands in `outline.intro` as one chunk.
 *
 * Output is deterministic: the same seed always produces byte-identical files,
 * so measurements are comparable across runs and machines.
 *
 * Usage:
 *   node scripts/generate-perf-corpus.mjs <target-dir> [--cp1252] [--profile <default|fixture>]
 *
 * `--cp1252` additionally writes the largest document in CP1252 instead of
 * UTF-8, reproducing the separate encoding defect where a non-UTF-8 file is
 * read as UTF-8 and every accented character becomes U+FFFD.
 *
 * `--profile fixture` generates the small, committed Gate 1b corpus instead
 * of the full Gate 2 perf corpus: one heading-less ~12,000-character document
 * carrying the `QUETZAL-7731` marker at ~char 6,000, plus 5 short distractor
 * documents. Same prose vocabulary and `MARKER` constant as the default
 * profile — one source of truth for both gates.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SEED = 0x5eed_1234;

/** xorshift32 — small, deterministic, and dependency-free. */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

const random = createRandom(SEED);
const pick = (items) => items[Math.floor(random() * items.length)];

// Neutral Spanish maintenance/asset-management vocabulary. Spanish matters:
// `estimateTokens` is chars/4 and under-counts Spanish, and the embedding
// model is multilingual, so an English corpus would not reproduce the ratios.
const SUBJECTS = [
  "el responsable de mantenimiento", "el técnico asignado", "el supervisor de zona",
  "la orden de trabajo", "el parte de incidencia", "el contrato de servicio",
  "el equipo instalado", "la revisión preventiva", "el almacén de repuestos",
  "la planificación semanal", "el presupuesto aprobado", "el proveedor externo",
];
const VERBS = [
  "registra", "valida", "aprueba", "consulta", "modifica", "cierra",
  "planifica", "asigna", "revisa", "documenta", "notifica", "archiva",
];
const OBJECTS = [
  "la intervención correspondiente", "los materiales consumidos",
  "el estado del activo", "las horas imputadas", "la fecha de vencimiento",
  "el nivel de prioridad", "la ubicación exacta", "los adjuntos requeridos",
  "el importe estimado", "la firma del solicitante", "el histórico de averías",
  "las condiciones del contrato",
];
const CLAUSES = [
  "antes de confirmar el cierre",
  "siempre que exista un contrato en vigor",
  "salvo que la incidencia sea de carácter urgente",
  "de acuerdo con el calendario preventivo definido",
  "dejando constancia en el registro de auditoría",
  "sin necesidad de aprobación adicional",
  "cuando el importe supera el umbral configurado",
  "una vez verificada la disponibilidad de repuestos",
];

function sentence() {
  return `${pick(SUBJECTS)} ${pick(VERBS)} ${pick(OBJECTS)} ${pick(CLAUSES)}.`;
}

/** Builds blank-line-separated paragraphs until `targetChars` is reached. */
function prose(targetChars) {
  const paragraphs = [];
  let length = 0;
  while (length < targetChars) {
    const lines = [];
    const sentences = 3 + Math.floor(random() * 4);
    for (let i = 0; i < sentences; i++) lines.push(sentence());
    const paragraph = lines.join(" ");
    paragraphs.push(paragraph);
    length += paragraph.length + 2;
  }
  return paragraphs.join("\n\n").slice(0, targetChars).trimEnd();
}

/**
 * The Gate 1b marker. Placed deep inside the oversized document, far past the
 * ~384-word point where the embedding model stops absorbing content, and
 * worded so it shares no vocabulary with the surrounding filler — otherwise a
 * retrieval hit would prove nothing about which chunk matched.
 */
const MARKER =
  "El código de verificación interna para pruebas de recuperación es " +
  "QUETZAL-7731: un identificador deliberadamente ajeno al vocabulario del " +
  "resto del documento, situado muy por detrás del inicio para comprobar si " +
  "la búsqueda vectorial alcanza el final de un documento desmedido.";

/** A heading-less document: title line, prose, no `#` anywhere. */
function headinglessDocument(targetChars, { marker = false } = {}) {
  const head = prose(Math.floor(targetChars * (marker ? 0.5 : 1)));
  if (!marker) return head;
  const tail = prose(targetChars - head.length - MARKER.length - 4);
  return `${head}\n\n${MARKER}\n\n${tail}`;
}

/** A single H2 holding a wide table — the one oversized chunk that is tabular. */
function spreadsheetDocument(targetChars) {
  const header = "| Referencia | Descripción | Situación actual | Propuesta |\n|---|---|---|---|";
  const rows = [];
  let length = header.length;
  let index = 1;
  while (length < targetChars) {
    const row =
      `| REF-${String(index).padStart(4, "0")} | ${pick(OBJECTS)} | ${pick(CLAUSES)} | ${pick(VERBS)} ${pick(OBJECTS)} |`;
    rows.push(row);
    length += row.length + 1;
    index += 1;
  }
  return `## Hoja1\n\n${header}\n${rows.join("\n")}`;
}

/** A well-formed document: H1, intro, and H2 sections above `minTokens`. */
function structuredDocument(title, sectionCount, sectionChars) {
  const parts = [`# ${title}`, "", prose(600), ""];
  for (let i = 1; i <= sectionCount; i++) {
    parts.push(`## ${pick(["Reglas de negocio", "Casos de uso", "Modelo de datos", "Validaciones", "Flujo operativo", "Límites y umbrales", "Integraciones"])} ${i}`);
    parts.push("");
    parts.push(prose(sectionChars));
    parts.push("");
  }
  return parts.join("\n");
}

/** Gate 2 perf corpus: 38 documents, 5 of them oversized and heading-less. */
function generateDefaultProfile(target, asCp1252) {
  const docsDir = join(target, "docs");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(join(docsDir, "ba"), { recursive: true });
  mkdirSync(join(docsDir, "arch"), { recursive: true });

  const write = (relative, content, encoding = "utf8") =>
    writeFileSync(join(docsDir, relative), content, encoding);

  // The five oversized, heading-less documents. Character targets are
  // estimateTokens x 4, matching the measured real-corpus distribution.
  const manual = headinglessDocument(167_345, { marker: true });
  if (asCp1252) {
    // latin1 is CP1252-compatible only for the 0xA0-0xFF accented-vowel range
    // this prose uses -- NOT in general (0x80-0x9F diverges: latin1 maps
    // those bytes to C1 controls, CP1252 maps 27 of them to curly quotes,
    // dashes, and similar punctuation). Not a model for decode-text.ts.
    write("ba/manual.md", manual, "latin1");
  } else {
    write("ba/manual.md", manual);
  }
  write("ba/manual-basico.md", headinglessDocument(11_632));
  write("ba/presentacion-sistemas.md", headinglessDocument(9_844));
  write("ba/comparativa.md", spreadsheetDocument(7_906));
  write("ba/resumen-rapido.md", headinglessDocument(4_474));

  // 33 conforming documents carrying the rest of the corpus. Each emits one
  // intro chunk plus one per H2 section; the 27/6 split lands the corpus on
  // the real one's 242 total chunks (27x7 + 6x8 + 5 oversized).
  for (let i = 1; i <= 33; i++) {
    const sections = i <= 27 ? 6 : 7;
    write(
      `arch/spec-${String(i).padStart(2, "0")}.md`,
      structuredDocument(`Especificación funcional ${i}`, sections, 920),
    );
  }

  console.log(`corpus generado en ${docsDir}`);
  console.log(`  38 documentos, semilla ${SEED}`);
  console.log(`  marcador de la puerta 1b: QUETZAL-7731 (dentro de ba/manual.md)`);
  if (asCp1252) console.log("  ba/manual.md escrito en CP1252");
}

/**
 * Gate 1b fixture corpus: one heading-less ~12,000-character marker document
 * plus 5 short distractor documents, all heading-less so none of them can be
 * reached by a heading-title lexical match. Cheap enough (seconds, not
 * minutes) to commit and re-run on every future chunking change.
 */
function generateFixtureProfile(target) {
  const docsDir = join(target, "docs");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(docsDir, { recursive: true });

  const write = (relative, content) => writeFileSync(join(docsDir, relative), content, "utf8");

  write("manual-extenso.md", headinglessDocument(12_000, { marker: true }));
  const distractorSizes = [3_000, 3_200, 3_400, 3_600, 3_800];
  distractorSizes.forEach((size, index) => {
    write(`distractor-${String(index + 1).padStart(2, "0")}.md`, headinglessDocument(size));
  });

  console.log(`fixture generated at ${docsDir}`);
  console.log(`  1 marker document (~12,000 chars) + 5 distractor documents, seed ${SEED}`);
  console.log(`  Gate 1b marker: QUETZAL-7731 (inside manual-extenso.md)`);
}

// --- main ---------------------------------------------------------------

const target = process.argv[2];
const asCp1252 = process.argv.includes("--cp1252");
const profileFlagIndex = process.argv.indexOf("--profile");
const profile = profileFlagIndex === -1 ? "default" : process.argv[profileFlagIndex + 1];
if (target === undefined) {
  console.error(
    "usage: node scripts/generate-perf-corpus.mjs <target-dir> [--cp1252] [--profile <default|fixture>]",
  );
  process.exit(1);
}
if (profile !== "default" && profile !== "fixture") {
  console.error(`unknown --profile "${profile}" (expected "default" or "fixture")`);
  process.exit(1);
}

if (profile === "fixture") {
  generateFixtureProfile(target);
} else {
  generateDefaultProfile(target, asCp1252);
}
