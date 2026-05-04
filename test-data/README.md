# Test Data — SW Units Feature

Estos ficheros sirven para probar la funcionalidad de **SW Units** y el **diff viewer** de la herramienta.

---

## Ficheros incluidos

| Fichero | Uso |
|---------|-----|
| `sw-project-v1.zip` | Primera subida — 9 SW units nuevas (todos los tipos) |
| `sw-project-v2.zip` | Segunda subida — 3 ficheros modificados |
| `sample-sw-project/` | Código fuente original para referencia |

### Estructura del proyecto de ejemplo

```
src/
  motor/
    motor_control.c   — Control PID del motor BLDC             (@type function, ASIL B)
    motor_isr.c       — ISR encoder quadratura + ISR timer PWM (@type isr, ASIL B)
  rtos/
    tasks.c           — motor_task + safety_task (FreeRTOS)    (@type task, ASIL B)
  config/
    calibration.c     — Ganancias PID, umbrales, tabla NTC      (@type calibration, ASIL B)
  sensors/
    speed_sensor.c    — Driver encoder → RPM                   (@type function, ASIL B)
    temperature_sensor.c — Driver NTC → °C                     (@type function, ASIL A)
  safety/
    safety_monitor.c  — Supervisor de seguridad central        (@type state_machine, ASIL B)
include/
    motor_control.h                                            (@type general)
    safety_monitor.h                                           (@type general)
```

### Tipos de SW unit cubiertos

| Tipo | Archivo |
|------|---------|
| `function` | motor_control.c, speed_sensor.c, temperature_sensor.c |
| `isr` | motor_isr.c |
| `task` | tasks.c |
| `calibration` | calibration.c |
| `state_machine` | safety_monitor.c |
| `general` | motor_control.h, safety_monitor.h |

### Cambios entre v1 y v2

**3 ficheros modificados** (6 unchanged):

| Fichero | Cambios |
|---------|---------|
| `src/motor/motor_control.c` | PID_KP 1.2→1.5, OVER_TEMP 85→90, anti-windup + fault LED |
| `src/rtos/tasks.c` | Stack size 256→384 (overflow fix), nueva llamada `safety_log_event` en undervoltage |
| `src/config/calibration.c` | CAL_OVER_TEMP_C 85→90, CAL_WARN_TEMP_C 75→80, CAL_UNDERVOLT_MV 10500→10000 |

---

## Pasos para probar

### 1. Preparación

Asegúrate de haber ejecutado `db/migration_sw_units.sql` y `db/migration_sw_unit_types.sql` en Supabase.

### 2. Crear SW units desde cero (subida v1)

1. Abre la herramienta → selecciona tu proyecto → selecciona un ítem → **SW Units** (sidebar)
2. Haz click en **⬆ Upload Code (ZIP)**
3. Selecciona `sw-project-v1.zip`
4. Deja el prefijo vacío (los paths ya son relativos)
5. Haz click en **Import**
6. **Resultado esperado:** `9 new · 0 changed · 0 unchanged`
7. Verifica que aparecen 9 SW units con sus tipos correctos (ISR, Task, Calibration, etc.)

### 3. Detectar cambios (subida v2)

1. Vuelve a **⬆ Upload Code (ZIP)**
2. Selecciona `sw-project-v2.zip`
3. Haz click en **Import**
4. **Resultado esperado:** `0 new · 3 changed · 6 unchanged`
5. Las SW units con badge **⚠ Changed**: `motor_control.c`, `tasks.c`, `calibration.c`

### 4. Crear una review session con las SW units

1. Haz click en el badge **⚠ Changed** de cualquier fichero → abre el wizard pre-seleccionado
   — o bien — ve a **Reviews → New Review Session**
2. En Step 1: asegúrate de que el modo es **Internal**
3. En Step 2 (Artifacts): selecciona las SW units que quieras revisar
4. Completa reviewers y confirma

### 5. Probar el diff viewer

Una vez dentro de la sesión:

- El **panel central** mostrará el diff entre v1 y v2
  - Líneas en **verde** (+) = añadidas en v2
  - Líneas en **rojo** (-) = eliminadas/modificadas de v1
  - Toggle **"Diff view" / "Full file"** en la esquina superior derecha
- Haz click en un número de línea → abre el formulario de **Raise Finding** anclado a esa línea
- El **panel derecho (Properties)** muestra veredicto y findings

### 6. Probar el modo review externo

1. Ve a **Project Settings → Review Mode**
2. Cambia a **External** y marca los campos requeridos (URL + Verdict)
3. Guarda
4. Crea una nueva review session → en Step 1 aparecerá el modo **External**
5. En el execute page, el panel central mostrará el formulario de evidencia externa

### 7. Verificar parsing de headers

1. Abre **Project Settings → Header Keywords** y verifica los keywords configurados
2. Sube `sw-project-v1.zip` desde cero (borra las units antes si ya existen)
3. Comprueba que los campos se auto-rellenan:
   - Unit Code = `SWU-MOT-001`, `SWU-MOT-002`, `SWU-RTOS-001`, `SWU-CFG-001`, etc.
   - Unit Type = `function`, `isr`, `task`, `calibration`, `state_machine`, `general`
   - Description incluye ASIL, SDD y Req

---

## Notas

- Los ficheros `.h` también se importan como SW units
- El hash SHA-256 se calcula en el cliente (WebCrypto API)
- Los ficheros `*_v2.c` en `sample-sw-project/` son solo para referencia — los ZIPs ya los incluyen como `tasks.c` / `calibration.c` / `motor_control.c`
