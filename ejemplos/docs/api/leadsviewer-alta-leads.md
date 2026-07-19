---
tipo: api
modulo: leadsviewer
estado: vigente
propietario: DEV
etiquetas: [lead, endpoint, alta, rest]
actualizado: 2026-07-19
---

# API leadsviewer: alta y edición de leads

Contrato REST del alta, edición y consulta de leads. Lo consumen el formulario web y la importación por CSV; ambos aplican las mismas reglas de validación documentadas en la especificación funcional.

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/v1/leads` | Crea un lead tras validar y normalizar los datos |
| PUT | `/api/v1/leads/{id}` | Edita un lead existente; revalida la duplicidad si cambia el email |
| GET | `/api/v1/leads/{id}` | Devuelve la ficha completa de un lead |
| GET | `/api/v1/leads?email=` | Comprueba si existe un lead con ese email normalizado |

## Modelos de datos

Petición de alta (`POST /api/v1/leads`):

```json
{
  "nombre": "Ana",
  "apellidos": "García López",
  "email": "ana.garcia@empresa.com",
  "telefono": "+34600112233",
  "empresa": "Empresa S.L.",
  "origen": "evento",
  "consentimiento": true,
  "notas": "Interesada en el plan anual"
}
```

La respuesta devuelve el lead creado con `id`, los campos normalizados y `consentimiento_fecha` en UTC.

## Errores

| Código | Condición | Cuerpo |
|--------|-----------|--------|
| 400 | Algún campo no pasa la validación | Lista de campos con su motivo |
| 409 | Ya existe un lead con el mismo email normalizado | `id` del lead existente |
| 422 | `consentimiento` es `false` | Motivo: consentimiento RGPD requerido |

## Ejemplos

Comprobación de duplicado antes del envío del formulario:

```
GET /api/v1/leads?email=ana.garcia%40empresa.com
200 -> { "existe": true, "id": "l_8f3a" }
```

## Referencias

- Reglas de validación y mensajes de error: [validación del formulario](../funcional/leadsviewer-validacion-formulario.md).
