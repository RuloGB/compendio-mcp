---
tipo: funcional
modulo: informes
estado: vigente
propietario: BA
etiquetas: [kpi, panel, conversion, seguimiento]
actualizado: 2026-07-19
---

# Panel de métricas de actividad comercial

Describe el panel de informes de LeadsViewer: qué indicadores muestra, cómo se calculan y qué filtros admite. Consultar antes de añadir un KPI nuevo o al revisar discrepancias en las cifras.

## Contexto y objetivo

El equipo comercial necesita saber de un vistazo cuántos leads entran, por qué canal y cuántos acaban en conversión. El panel de métricas resume la actividad sin exportar nada a hojas de cálculo, con cifras calculadas siempre con las mismas definiciones del glosario.

## Indicadores del panel

| KPI | Definición | Cálculo |
|---|---|---|
| Leads nuevos | Leads creados en el periodo seleccionado | Recuento por fecha de alta |
| Leads por origen | Distribución por canal de entrada | Recuento agrupado por `origen` |
| Tasa de conversión | Porcentaje de leads que pasan a oportunidad | Conversiones / leads nuevos del periodo |
| Tiempo hasta primer contacto | Mediana de horas entre el alta y la primera interacción | Mediana sobre leads con al menos una interacción |

Los indicadores se recalculan cada hora; el panel muestra la hora del último cálculo.

## Filtros

- **Periodo**: hoy, últimos 7 días, últimos 30 días o rango de fechas propio.
- **Origen**: uno o varios canales de la lista cerrada.
- **Comercial**: usuario responsable del lead.

Los filtros se combinan entre sí y se reflejan en la URL, de modo que una vista filtrada se puede compartir con un enlace.

## Fuera de alcance

- Exportación de informes a PDF o a hojas de cálculo.
- Cuadros de mando personalizables por usuario.
- Previsión de ventas y modelos predictivos.

## Referencias

- Términos `conversión` y `KPI`: ver [glosario](../glosario.md).
- Canal de entrada de los leads: [validación del formulario](leadsviewer-validacion-formulario.md).
