---
tipo: qa
modulo: informes
estado: borrador
propietario: QA
etiquetas: [pruebas, panel, kpi]
actualizado: 2026-07-19
---

# Plan de pruebas: panel de métricas

Borrador del plan de pruebas del panel de informes. Pendiente de revisar con el BA las definiciones de cálculo antes de dar el plan por vigente.

## Alcance

Verificación de los KPI del panel y de la combinación de filtros por periodo, origen y comercial.

## Casos de prueba

| ID | Descripción | Pasos | Resultado esperado |
|----|-------------|-------|--------------------|
| INF-01 | Recuento de leads nuevos | Crear 3 leads hoy y abrir el panel con periodo «hoy» | El KPI muestra 3 |
| INF-02 | Filtro por origen | Filtrar por `evento` | Solo se contabilizan leads de ese canal |

## Datos de prueba

Pendiente de definir la semilla de datos del entorno de pruebas.

## Criterios de salida

Pendiente de acordar con el BA.
