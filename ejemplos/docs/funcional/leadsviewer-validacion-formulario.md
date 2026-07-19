---
tipo: funcional
modulo: leadsviewer
estado: vigente
propietario: BA
etiquetas: [lead, validacion, formulario, rgpd]
actualizado: 2026-07-19
---

# Validación del formulario de alta de leads

Define las reglas de validación del formulario de alta y edición de leads en LeadsViewer: campos, formatos, obligatoriedad, tratamiento de duplicados y consentimiento RGPD. Consultar antes de implementar o modificar el formulario, o al revisar incidencias con datos de leads.

## Contexto y objetivo

LeadsViewer es la aplicación web para gestionar leads (clientes potenciales; ver glosario). El formulario de alta es la vía principal de entrada de datos: la calidad del resto del sistema (listados, seguimiento, informes) depende de que los datos entren validados y normalizados.

El objetivo de estas reglas es que ningún lead se guarde con datos inválidos, incompletos o duplicados, y que el usuario reciba mensajes de error claros en el momento.

Las validaciones se aplican en el cliente (respuesta inmediata al usuario) y se repiten en el servidor (fuente de verdad). Ambas capas implementan exactamente estas mismas reglas.

## Reglas de negocio

### Campos y validaciones

| Campo | Obligatorio | Formato / regla | Normalización al guardar |
|---|---|---|---|
| Nombre | Sí | 2–60 caracteres; letras, espacios, guiones y apóstrofes | Recorte de espacios; inicial en mayúscula |
| Apellidos | Sí | 2–80 caracteres; mismas reglas que Nombre | Igual que Nombre |
| Email | Sí | Formato `usuario@dominio.tld` | Minúsculas; recorte de espacios |
| Teléfono | No | 9 dígitos (España) o formato internacional E.164 (`+34600112233`) | Se almacena en E.164, sin espacios ni guiones |
| Empresa | No | 2–100 caracteres | Recorte de espacios |
| Origen | Sí | Valor de lista cerrada: `web`, `evento`, `referido`, `llamada`, `otro` | — |
| Consentimiento RGPD | Sí | Casilla marcada explícitamente por el usuario | Se guarda con fecha y hora (UTC) de aceptación |
| Notas | No | Máximo 1000 caracteres | Recorte de espacios |

### Reglas de duplicidad

Un lead se considera duplicado cuando su email normalizado coincide con el de un lead ya existente, en cualquier estado.

1. Al validar el campo Email, el sistema comprueba duplicados antes de permitir el envío.
2. Si existe un duplicado, se bloquea el alta y se muestra el mensaje correspondiente (ver [Mensajes de error](#mensajes-de-error)) con un enlace a la ficha del lead existente.
3. No se fusionan datos automáticamente; la fusión de leads queda fuera del alcance de este documento.

El teléfono no se usa como clave de duplicidad en esta versión: un mismo teléfono de centralita puede pertenecer a varios contactos de una empresa.

### Consentimiento RGPD

- No se puede guardar un lead sin la casilla de consentimiento marcada.
- La casilla nunca viene marcada por defecto y su texto enlaza a la política de privacidad.
- Se guardan fecha y hora (UTC) de la aceptación junto al lead, como evidencia del consentimiento.

### Mensajes de error

Los mensajes se muestran junto al campo afectado cuando este pierde el foco, y de nuevo al intentar enviar el formulario.

| Condición | Mensaje |
|---|---|
| Campo obligatorio vacío | «Este campo es obligatorio» |
| Email con formato inválido | «Introduce un email válido (ejemplo: nombre@empresa.com)» |
| Email duplicado | «Ya existe un lead con este email» + enlace a su ficha |
| Teléfono con formato inválido | «Introduce un teléfono de 9 dígitos o en formato internacional (+34...)» |
| Longitud excedida | «Máximo N caracteres» (N según el campo) |
| Consentimiento sin marcar | «Debes aceptar la política de privacidad para guardar el lead» |

## Casos de uso

1. **Alta de lead válido.** El usuario rellena Nombre, Apellidos, Email y Origen, marca el consentimiento y guarda. El sistema normaliza los datos, guarda la fecha del consentimiento y muestra la ficha del nuevo lead.
2. **Alta con email duplicado.** El usuario introduce un email ya existente. Al salir del campo, el sistema muestra el error de duplicado con el enlace a la ficha existente y bloquea el envío.
3. **Alta sin consentimiento.** El usuario completa todos los campos pero no marca la casilla RGPD. Al pulsar guardar se muestra el error y no se persiste nada.
4. **Edición de un lead existente.** Se aplican las mismas reglas que en el alta; si se modifica el email, se vuelve a comprobar la duplicidad excluyendo al propio lead.

## Fuera de alcance

- Importación masiva de leads: ver [importación por CSV](leadsviewer-importacion-csv.md).
- Fusión de leads duplicados ya existentes en el sistema.
- Puntuación (scoring) y cualificación de leads.
- Sincronización con CRMs externos.

## Referencias

- Términos `lead`, `leadsviewer` y `origen`: ver [glosario](../glosario.md).
- Contrato de API de alta y edición de leads: [api/leadsviewer-alta-leads.md](../api/leadsviewer-alta-leads.md).
