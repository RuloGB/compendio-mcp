---
tipo: adr
modulo: transversal
estado: obsoleto
propietario: ARQ
etiquetas: [mongodb, persistencia]
actualizado: 2026-05-02
sustituido-por: adr/adr-0007-eleccion-base-datos.md
---

# ADR-0001: MongoDB como base de datos inicial

Decisión original de arranque del proyecto: usar MongoDB por velocidad de desarrollo con un esquema aún inestable. Obsoleto: sustituido por [ADR-0007](adr-0007-eleccion-base-datos.md), que adopta PostgreSQL.

## Contexto

Al inicio del proyecto el modelo de lead cambiaba cada semana y el equipo priorizaba iterar rápido sobre definir un esquema cerrado.

## Decisión

Usar MongoDB como almacén principal, con un documento por lead y las interacciones embebidas.

## Alternativas consideradas

- **PostgreSQL**: descartado entonces por la fricción de migrar el esquema en cada iteración temprana.

## Consecuencias

- Arranque rápido del prototipo.
- Con el crecimiento del panel de métricas, las agregaciones y la falta de transacciones se volvieron un problema; ver [ADR-0007](adr-0007-eleccion-base-datos.md).
