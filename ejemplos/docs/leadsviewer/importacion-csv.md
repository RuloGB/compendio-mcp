---
etiquetas: [lead, importacion, csv, lote]
---

# Importación masiva de leads por CSV

Define cómo se cargan leads en lote desde un fichero CSV: formato del fichero, validación por fila, tratamiento de duplicados y el informe de resultado. Consultar antes de implementar la importación o de preparar un fichero de carga.

## Contexto y objetivo

Los equipos comerciales reciben listas de contactos tras cada evento o campaña. Darlos de alta uno a uno en el formulario es inviable a partir de unas decenas, así que LeadsViewer permite subir un fichero CSV y crear los leads en un solo paso.

La importación aplica exactamente las mismas reglas de validación que el formulario de alta: un fichero no es una vía para saltarse las validaciones.

## Formato del fichero

- Codificación UTF-8, separador coma o punto y coma (se detecta automáticamente).
- Primera fila de cabeceras, con estos nombres: `nombre`, `apellidos`, `email`, `telefono`, `empresa`, `origen`, `consentimiento`, `notas`.
- Máximo 5000 filas por fichero; por encima, el fichero se rechaza completo.
- La columna `consentimiento` solo admite `si` o `no`. Las filas con `no` se rechazan: sin consentimiento RGPD no se crea el lead.

## Validación por fila

1. Cada fila se valida de forma independiente con las reglas del formulario de alta (ver [validación del formulario](validacion-formulario.md)).
2. Una fila inválida no detiene la importación: se anota el motivo y se continúa con la siguiente.
3. Si el email de una fila ya existe en el sistema, o aparece dos veces dentro del propio fichero, la fila se marca como duplicada y no se crea.
4. Los valores de `origen` fuera de la lista cerrada se rechazan; no se crean orígenes nuevos desde un CSV.

## Informe de resultado

Al terminar, el sistema muestra y permite descargar un informe con tres bloques:

| Bloque | Contenido |
|---|---|
| Creados | Filas convertidas en lead, con enlace a cada ficha |
| Duplicados | Filas descartadas por email ya existente, con enlace al lead original |
| Inválidos | Filas rechazadas, con el motivo exacto por campo |

El informe queda disponible durante 30 días en el historial de importaciones del usuario.

## Fuera de alcance

- Actualización de leads existentes desde CSV (solo altas).
- Importación desde hojas de cálculo en la nube o CRMs externos.
- Programación de importaciones recurrentes.

## Referencias

- Reglas de validación de campos: [validación del formulario](validacion-formulario.md).
- Término `origen`: ver [glosario](../glosario.md).
