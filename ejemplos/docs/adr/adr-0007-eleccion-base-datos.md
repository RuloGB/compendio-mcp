---
tipo: adr
modulo: transversal
estado: vigente
propietario: ARQ
etiquetas: [postgresql, persistencia, transacciones]
actualizado: 2026-07-19
---

# ADR-0007: PostgreSQL como base de datos del sistema

Se decidió usar PostgreSQL como base de datos única del sistema, en sustitución de MongoDB, por la necesidad de transacciones y de integridad referencial entre leads, interacciones e informes.

## Contexto

El modelo de datos de LeadsViewer es relacional en la práctica: un lead tiene interacciones, un comercial responsable y aparece agregado en los informes. Con MongoDB (ver [ADR-0001](adr-0001-eleccion-mongodb.md), hoy obsoleto) las agregaciones del panel de métricas exigían duplicar datos, y la ausencia de transacciones entre colecciones provocó inconsistencias al importar ficheros CSV grandes.

## Decisión

Adoptar PostgreSQL 16 como base de datos única:

- Esquema relacional con claves foráneas entre leads, interacciones y usuarios.
- Transacciones en la importación masiva: cada fila se confirma o se revierte completa.
- Las agregaciones del panel de métricas se resuelven con SQL estándar y vistas materializadas.
- La restricción de email único se implementa como índice único en la tabla de leads.

## Alternativas consideradas

- **Seguir con MongoDB**: descartado; las necesidades de agregación y consistencia superan las ventajas del esquema flexible.
- **MySQL**: viable, pero PostgreSQL ofrece vistas materializadas y tipos JSON más maduros para los campos semiestructurados de notas.
- **SQLite**: suficiente para un solo nodo, pero el sistema necesita conexiones concurrentes de varios servicios.

## Consecuencias

- Migración de datos desde MongoDB con un script único de corte (ejecutada en 2026-05).
- El equipo mantiene un único dialecto SQL; desaparecen las agregaciones ad hoc en código.
- Las copias de seguridad pasan a `pg_dump` diario con retención de 30 días.
