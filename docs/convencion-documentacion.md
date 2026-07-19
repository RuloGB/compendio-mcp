---
tipo: guia
modulo: transversal
estado: borrador
propietario: ARQ
etiquetas: [documentacion, convencion, ia, busqueda]
actualizado: 2026-07-20
---

# Convención de documentación del proyecto

Esta convención define cómo escribimos y organizamos la documentación del proyecto para que sea fácil de encontrar tanto por personas como por los agentes de IA del harness (OpenCode), gastando el mínimo de tokens posible. Toda la documentación vive en el repositorio, en `docs/`, y evoluciona junto al código.

## 1. Principios

1. **Un tema por fichero.** Un documento responde a una pregunta o describe una cosa. Si mezcla temas, se divide.
2. **Escribimos para dos lectores.** Personas y agentes de IA. Lo que ayuda a uno ayuda al otro: resúmenes claros, secciones bien tituladas, terminología consistente.
3. **La documentación acompaña al cambio.** Quien cambia un comportamiento documentado se asegura de que el documento se actualice en la misma tarea: lo actualiza si es propietario de ese tipo de documento, o avisa a quien lo sea (normalmente, el BA). Lo que no vale es entregar el cambio dejando la documentación desactualizada en silencio.
4. **Metadatos antes que contenido.** Cada documento declara qué es (frontmatter) para poder filtrarlo sin necesidad de leerlo.
5. **Nada se borra.** Los documentos obsoletos se marcan como tales y apuntan a su sustituto. El historial de decisiones es valioso.

En `docs/` va documentación del producto y del sistema. No van actas de reuniones, notas personales ni tareas pendientes (para eso están las herramientas de gestión del equipo).

## 2. Estructura de carpetas

```
docs/
├── INDEX.md          # Índice: una línea por documento
├── glosario.md       # Términos canónicos del proyecto
├── funcional/        # Especificaciones funcionales        → escribe BA
├── adr/              # Decisiones de arquitectura           → escribe ARQ
├── api/              # Contratos, endpoints, modelos        → escribe DEV
├── qa/               # Planes y casos de prueba             → escribe QA
└── guias/            # Guías operativas y transversales     → cualquiera
```

- El primer nivel se organiza **por tipo de documento**, y cada tipo tiene un rol propietario natural (los mismos roles que usa el harness: BA, ARQ, DEV, QA). Propietario no significa autor exclusivo: significa responsable de que esa carpeta esté al día.
- El **módulo** al que pertenece un documento se indica en el frontmatter y en el nombre del fichero, no con subcarpetas. Evitamos árboles profundos: dos niveles como máximo.

## 3. Nombres de fichero

- `kebab-case`, en minúsculas, sin acentos ni eñes: `leadsviewer-validacion-formulario.md`.
- Patrón general: `<modulo>-<tema>.md`.
- ADRs numerados: `adr-0007-eleccion-base-datos.md`. El número es secuencial y nunca se reutiliza, aunque el ADR quede obsoleto.
- Si un fichero supera las ~400 líneas, probablemente son dos temas: se divide.

## 4. Frontmatter obligatorio

Todo documento empieza con un bloque YAML. Es el contrato de datos del documento: permite filtrar por tipo, módulo o estado —por ejemplo, con un grep sobre el frontmatter— sin gastar un solo token en leer contenido.

```yaml
---
tipo: funcional            # obligatorio: funcional | adr | api | qa | guia
modulo: leadsviewer        # obligatorio: debe existir en glosario.md
estado: vigente            # obligatorio: borrador | vigente | obsoleto
propietario: BA            # recomendado: BA | ARQ | DEV | QA
etiquetas: [lead, validacion, formulario, rgpd]  # recomendado: 3-6, en minúsculas y singular
actualizado: 2026-07-20    # recomendado: AAAA-MM-DD
sustituido-por:            # solo si estado: obsoleto (ruta al doc que lo sustituye)
---
```

Reglas:

- `tipo`, `estado` y `propietario` solo admiten los valores de la lista. No inventamos valores nuevos sin actualizar esta convención.
- `modulo` debe estar dado de alta en `glosario.md`. Si el módulo es nuevo, primero se añade al glosario.
- Las `etiquetas` complementan al módulo, no lo repiten.

## 5. Estructura interna del documento

1. **Un único título H1**, igual o casi igual al nombre del fichero.
2. **El primer párrafo es un resumen de 2-3 líneas**: qué es este documento y cuándo consultarlo. Leyéndolo, una persona o un agente decide si está en el documento correcto sin abrirlo entero, así que tiene que sostenerse solo.
3. **Encabezados H2/H3 descriptivos y estables.** Los agentes localizan el contenido por los encabezados y leen solo la sección que necesitan ("dame *Reglas de validación* de tal documento"). Nada de encabezados genéricos ("Otros temas", "Más información") y no se renombran secciones sin motivo.
4. **Secciones autocontenidas.** Cada H2 debe entenderse sin leer el resto del documento, porque el agente puede recibir solo esa sección. Evitar "como se explicó arriba"; en su lugar, enlazar: "ver [Validación de Leads](leadsviewer-validacion-formulario.md#validación-de-leads)". Ojo: los anclas de GitHub conservan las tildes del encabezado.
5. **Datos estructurados en tablas**, pasos en listas numeradas, código en bloques con lenguaje indicado.
6. **Enlazar, no duplicar.** Si algo ya está documentado, se enlaza con ruta relativa. La información duplicada se desincroniza siempre.

## 6. Redacción

- **Idioma: español** en toda la documentación. Mezclar idiomas empeora tanto la búsqueda léxica como la semántica. Los términos técnicos asentados en inglés (endpoint, commit, pipeline) son válidos.
- **Terminología consistente.** Cada entidad, módulo o concepto tiene un único nombre, registrado en `glosario.md`. Si la misma cosa se llama "cliente", "customer" y "cuenta" según el documento, ni las personas ni los agentes la encontrarán bien.
- Frases cortas, voz activa, sin relleno.
- **Fechas absolutas** (2026-07-20), nunca relativas ("el mes pasado", "recientemente").

## 7. Ciclo de vida

`borrador → vigente → obsoleto`

- **borrador**: en elaboración o pendiente de revisión. No es fuente de verdad: los agentes deben ignorarlo salvo petición expresa.
- **vigente**: fuente de verdad. Es lo que el agente usará como contexto.
- **obsoleto**: ya no aplica, pero no se borra. Se marca, se rellena `sustituido-por` y se deja de mantener.

## 8. INDEX.md

Índice de toda la documentación: una línea por documento, con este formato:

```
- [funcional] funcional/leadsviewer-validacion-formulario.md — Reglas de validación del formulario de Leads (vigente)
- [adr] adr/adr-0007-eleccion-base-datos.md — Por qué PostgreSQL frente a MongoDB (vigente)
```

Leyendo solo este fichero, una persona o un agente se orienta sobre toda la documentación. Se actualiza a mano, en la misma PR que añade o cambia un documento.

## 9. Glosario

`docs/glosario.md` contiene los términos canónicos del proyecto: módulos, entidades de negocio y siglas, cada uno con una definición de una línea. Antes de nombrar algo nuevo en un documento, se comprueba si ya tiene nombre. El glosario es la fuente de verdad para el campo `modulo` del frontmatter.

## 10. Checklist para PRs con documentación

- [ ] Frontmatter completo y con valores válidos
- [ ] El primer párrafo resume el documento y se sostiene solo
- [ ] Encabezados descriptivos; secciones autocontenidas
- [ ] Terminología según `glosario.md` (módulos nuevos, dados de alta)
- [ ] `INDEX.md` actualizado
- [ ] Si el cambio afecta a comportamiento documentado, el documento está actualizado (o avisado su propietario)

## 11. Plantillas

### Especificación funcional (`docs/funcional/`)

```markdown
---
tipo: funcional
modulo: <modulo>
estado: borrador
propietario: BA
etiquetas: []
actualizado: AAAA-MM-DD
---

# <Nombre de la funcionalidad>

<Resumen de 2-3 líneas: qué hace, para quién y cuándo consultar este documento.>

## Contexto y objetivo
## Reglas de negocio
## Casos de uso
## Fuera de alcance
## Referencias
```

### Decisión de arquitectura (`docs/adr/`)

```markdown
---
tipo: adr
modulo: <modulo o transversal>
estado: vigente
propietario: ARQ
etiquetas: []
actualizado: AAAA-MM-DD
---

# ADR-NNNN: <Decisión en una frase>

<Resumen: qué se decidió y la razón principal.>

## Contexto
## Decisión
## Alternativas consideradas
## Consecuencias
```

### Contrato de API (`docs/api/`)

```markdown
---
tipo: api
modulo: <modulo>
estado: borrador
propietario: DEV
etiquetas: []
actualizado: AAAA-MM-DD
---

# API <módulo>: <recurso>

<Resumen: qué expone esta API y quién la consume.>

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|

## Modelos de datos
## Errores
## Ejemplos
```

### Plan de pruebas (`docs/qa/`)

```markdown
---
tipo: qa
modulo: <modulo>
estado: borrador
propietario: QA
etiquetas: []
actualizado: AAAA-MM-DD
---

# Plan de pruebas: <funcionalidad>

<Resumen: qué se prueba y con qué criterio de salida.>

## Alcance

## Casos de prueba

| ID | Descripción | Pasos | Resultado esperado |
|----|-------------|-------|--------------------|

## Datos de prueba
## Criterios de salida
```

## Anexo: racional técnico (por qué estas reglas)

Cada regla de esta convención reduce los tokens que un agente gasta al consultar la documentación, o mejora la precisión con la que encuentra lo que busca:

| Regla | Efecto al consultar la documentación |
|-------|--------------------------------------|
| Frontmatter con tipo/módulo/estado | Filtrar por metadatos (por ejemplo, con grep) descarta la mayor parte del corpus a coste cero |
| Primer párrafo = resumen | Con unas líneas basta para decidir si el documento es el correcto, sin leerlo entero |
| Encabezados estables y descriptivos | Lectura selectiva: el agente salta a la sección que necesita, no carga el fichero completo |
| Secciones autocontenidas | Una sección leída suelta se entiende por sí sola, sin arrastrar contexto extra |
| Glosario y terminología única | La búsqueda por palabras funciona; los sinónimos accidentales la rompen |
| INDEX.md | Orientación sobre todo el corpus por unos cientos de tokens, antes de cualquier búsqueda |
| Estados del ciclo de vida | Los borradores y obsoletos no contaminan el contexto del agente |
| Español consistente | Buscar en español encuentra lo escrito en español; la mezcla de idiomas rompe la búsqueda |
