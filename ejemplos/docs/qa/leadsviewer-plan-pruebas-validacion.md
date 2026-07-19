---
tipo: qa
modulo: leadsviewer
estado: vigente
propietario: QA
etiquetas: [pruebas, validacion, formulario]
actualizado: 2026-07-19
---

# Plan de pruebas: validación del formulario de leads

Casos de prueba del formulario de alta y edición de leads, derivados de la especificación funcional de validación. Criterio de salida: todos los casos en verde en el entorno de pruebas.

## Alcance

Cubre la validación de campos, la duplicidad por email y el consentimiento RGPD, tanto en cliente como en servidor. No cubre la importación por CSV, que tiene plan propio.

## Casos de prueba

| ID | Descripción | Pasos | Resultado esperado |
|----|-------------|-------|--------------------|
| VAL-01 | Alta válida completa | Rellenar campos obligatorios válidos, marcar consentimiento, guardar | Lead creado, datos normalizados, fecha de consentimiento en UTC |
| VAL-02 | Email con formato inválido | Introducir `ana@` y salir del campo | Mensaje «Introduce un email válido…»; envío bloqueado |
| VAL-03 | Email duplicado | Introducir el email de un lead existente | Mensaje de duplicado con enlace a la ficha existente |
| VAL-04 | Consentimiento sin marcar | Completar campos y guardar sin marcar la casilla | Mensaje de consentimiento; no se persiste nada |
| VAL-05 | Teléfono nacional | Introducir `600112233` | Se guarda como `+34600112233` |
| VAL-06 | Edición sin cambiar email | Editar nombre de un lead y guardar | No se ejecuta comprobación de duplicidad |
| VAL-07 | Longitud excedida en notas | Pegar 1001 caracteres en Notas | Mensaje «Máximo 1000 caracteres» |

## Datos de prueba

- Lead existente semilla: `ana.garcia@empresa.com`, origen `evento`.
- Cuenta de comercial con permisos de alta en el entorno de pruebas.

## Criterios de salida

- 100 % de los casos VAL en verde en dos ejecuciones consecutivas.
- Sin defectos abiertos de severidad alta sobre validación.
