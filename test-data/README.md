# Test Data — SW Units Feature

Estos ficheros sirven para probar la funcionalidad de **SW Units** y el **diff viewer** de la herramienta.

---

## Ficheros incluidos

| Fichero | Uso |
|---------|-----|
| `sw-project-v1.zip` | Primera subida — 6 SW units nuevas |
| `sw-project-v2.zip` | Segunda subida — `motor_control.c` modificado |
| `sample-sw-project/` | Código fuente original para referencia |

### Estructura del proyecto de ejemplo

```
src/
  motor/
    motor_control.c        — Control PID del motor BLDC (ASIL B)
  sensors/
    speed_sensor.c         — Driver encoder cuadratura → RPM
    temperature_sensor.c   — Driver NTC thermistor → °C
  safety/
    safety_monitor.c       — Supervisor de seguridad central (ASIL B)
include/
    motor_control.h
    safety_monitor.h
```

### Cambios entre v1 y v2

En `motor_control.c` (único fichero modificado):

| | v1 | v2 |
|--|-----|-----|
| `PID_KP` | 1.2 | **1.5** |
| `OVER_TEMP_THRESHOLD` | 85°C | **90°C** |
| Anti-windup integral | ✗ | **✓ añadido** |
| Fault LED en emergency stop | ✗ | **✓ añadido** |

---

## Pasos para probar

### 1. Preparación

Asegúrate de haber ejecutado `db/migration_sw_units.sql` en Supabase.

### 2. Crear SW units desde cero (subida v1)

1. Abre la herramienta → selecciona tu proyecto → selecciona un ítem → **SW Units** (sidebar)
2. Haz click en **⬆ Upload Code (ZIP)**
3. Selecciona `sw-project-v1.zip`
4. Deja el prefijo vacío (los paths ya son relativos)
5. Haz click en **Import**
6. **Resultado esperado:** `6 new · 0 changed · 0 unchanged`
7. Verifica que aparecen 6 SW units en la tabla

### 3. Detectar cambios (subida v2)

1. Vuelve a **⬆ Upload Code (ZIP)**
2. Selecciona `sw-project-v2.zip`
3. Haz click en **Import**
4. **Resultado esperado:** `0 new · 1 changed · 5 unchanged`
5. La SW unit `src/motor/motor_control.c` tendrá el badge **⚠ Changed**

### 4. Crear una review session con las SW units

1. Haz click en el badge **⚠ Changed** de `motor_control.c` → abre el wizard pre-seleccionado
   — o bien — ve a **Reviews → New Review Session**
2. En Step 1: asegúrate de que el modo es **Internal**
3. En Step 2 (Artifacts): selecciona las SW units que quieras revisar
4. Completa reviewers y confirma
5. Abre la sesión → en la lista de artefactos selecciona `motor_control.c`

### 5. Probar el diff viewer

Una vez dentro de la sesión con `motor_control.c`:

- El **panel central** mostrará el diff entre v1 y v2
  - Líneas en **verde** (+) = añadidas en v2
  - Líneas en **rojo** (-) = eliminadas/modificadas de v1
  - Toggle **"Diff view" / "Full file"** en la esquina superior derecha
- Haz click en un número de línea → abre el formulario de **Raise Finding** anclado a esa línea
- El **panel derecho (Properties)** muestra veredicto y findings igual que con cualquier otro artefacto

### 6. Probar el modo review externo

1. Ve a **Project Settings → Review Mode**
2. Cambia a **External** y marca los campos requeridos (URL + Verdict)
3. Guarda
4. Crea una nueva review session → en Step 1 aparecerá el modo **External** pre-seleccionado y un campo de URL
5. En el execute page, el panel central mostrará el formulario de evidencia externa en lugar del diff/checklist
6. Intenta completar la sesión sin rellenar la URL → verifica el modal de bloqueo

---

## Notas

- Los ficheros `.h` (headers) también se importan como SW units ya que tienen extensión reconocida
- Si quieres excluir los headers, usa el campo **Strip path prefix** para filtrar (o simplifica el ZIP)
- El hash SHA-256 se calcula en el cliente (WebCrypto API) — no se envía el código en claro al servidor excepto al guardar en Supabase
