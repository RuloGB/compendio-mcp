# Guía de despliegue a producción

Pasos para publicar una versión de LeadsViewer en producción, qué comprueba el pipeline y cómo revertir si algo sale mal. Consultar antes de cada despliegue y durante cualquier incidente de publicación.

## Entornos

| Entorno | Rama | Uso |
|---|---|---|
| desarrollo | cualquier rama | Trabajo diario de los desarrolladores |
| pruebas | `develop` | Verificación de QA sobre datos sintéticos |
| producción | `main` | Usuarios reales |

## Pipeline de publicación

1. La fusión a `main` lanza el pipeline: compilación, pruebas automáticas y análisis estático.
2. Si todo pasa, se construye la imagen y se etiqueta con la versión.
3. El despliegue a producción requiere aprobación manual de una persona del equipo responsable.
4. Tras publicar, el pipeline ejecuta una comprobación de humo: la aplicación responde y la migración de base de datos terminó sin errores.

## Migraciones de base de datos

- Las migraciones se ejecutan automáticamente antes de arrancar la nueva versión.
- Toda migración debe ser compatible con la versión anterior (desplegamos sin parada).
- Las migraciones destructivas (borrar columnas o tablas) se hacen en dos versiones: primera versión deja de usar, la siguiente borra.

## Reversión (rollback)

1. Volver a desplegar la etiqueta de la versión anterior desde el pipeline; no se revierte con commits.
2. Las migraciones no se deshacen: la compatibilidad hacia atrás de las migraciones garantiza que la versión anterior funcione con el esquema nuevo.
3. Registrar el incidente y su causa antes de reintentar el despliegue.

## Referencias

- Decisión de base de datos y política de copias: [ADR-0007](adr-0007-eleccion-base-datos.md).
