---
tipo: adr
modulo: transversal
estado: vigente
propietario: ARQ
etiquetas: [sso, oidc, seguridad, acceso]
actualizado: 2026-07-19
---

# ADR-0003: Autenticación mediante SSO corporativo (OIDC)

Se decidió delegar la autenticación en el proveedor de identidad corporativo mediante OpenID Connect, en lugar de mantener usuarios y credenciales propios en LeadsViewer.

## Contexto

Los usuarios de LeadsViewer son empleados que ya inician sesión a diario en el resto de herramientas internas con la cuenta corporativa. Mantener credenciales propias duplicaría el ciclo de vida de las cuentas (altas, bajas, restablecimientos) y añadiría superficie de ataque.

## Decisión

- LeadsViewer actúa como cliente OIDC del proveedor de identidad corporativo (flujo authorization code con PKCE).
- Las bajas de empleados desactivan el acceso automáticamente al desaparecer la cuenta del proveedor.
- Los roles de la aplicación (comercial, responsable, administración) se leen de los grupos del directorio corporativo.
- No se almacena ninguna credencial en la base de datos de LeadsViewer.

## Alternativas consideradas

- **Usuarios y credenciales propios**: descartado por el coste operativo del ciclo de vida de cuentas y el riesgo de seguridad.
- **SAML 2.0**: soportado por el proveedor, pero OIDC encaja mejor con la aplicación web y las librerías actuales del equipo.

## Consecuencias

- El entorno local necesita un proveedor de identidad simulado para desarrollo sin conexión corporativa.
- La pantalla de acceso de LeadsViewer se reduce a un botón de inicio de sesión corporativo.
- Los permisos por rol dependen de que los grupos del directorio estén al día.
