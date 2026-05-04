#include "safety_monitor.h"
#include "temperature_sensor.h"
#include <stdint.h>
#include <stdbool.h>

#define WATCHDOG_MS  50u
#define VBAT_MIN_MV  10500u
#define TEMP_CRIT_C  95.0f
#define LOG_SIZE     16u

typedef struct { SafetyEvent_t event; uint32_t ts_ms; } LogEntry_t;
static LogEntry_t g_log[LOG_SIZE];
static uint8_t    g_head  = 0;
static bool       g_safe  = false;
static float      g_temp  = 0.0f;

/**
 * @unit    SWU-SAF-001
 * @name    safety_monitor_init
 * @type    function
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-001
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Clears log, resets state, starts watchdog.
 */
void safety_monitor_init(void)
{
    for (uint8_t i = 0; i < LOG_SIZE; i++) g_log[i] = (LogEntry_t){0, 0};
    g_head = 0; g_safe = false; g_temp = 0.0f;
    watchdog_init(WATCHDOG_MS);
}

/**
 * @unit    SWU-SAF-002
 * @name    safety_monitor_tick
 * @type    function
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-002, SWR-SAF-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Periodic safety check: over-temp and under-voltage detection.
 */
void safety_monitor_tick(void)
{
    watchdog_kick();
    g_temp = temperature_read_celsius();
    if (g_temp > TEMP_CRIT_C) { safety_log_event(SAFETY_EVENT_OVER_TEMP); safety_enter_safe_state(); }
    if (adc_read_vbat_mv() < VBAT_MIN_MV) { safety_log_event(SAFETY_EVENT_UNDERVOLTAGE); safety_enter_safe_state(); }
}

/**
 * @unit    SWU-SAF-003
 * @name    safety_log_event
 * @type    function
 * @asil    B
 * @sdd     SDD-SAF-002
 * @req     SWR-SAF-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Writes event + timestamp into the ring-buffer log.
 */
void safety_log_event(SafetyEvent_t event)
{
    g_log[g_head].event  = event;
    g_log[g_head].ts_ms  = system_get_tick_ms();
    g_head = (uint8_t)((g_head + 1u) % LOG_SIZE);
}

/**
 * @unit    SWU-SAF-004
 * @name    safety_get_temperature
 * @type    function
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-005
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Returns last sampled temperature in Celsius.
 */
float safety_get_temperature(void) { return g_temp; }

/**
 * @unit    SWU-SAF-005
 * @name    safety_enter_safe_state
 * @type    function
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-006
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Transitions system to safe state: disables actuators, sets fault output.
 */
void safety_enter_safe_state(void)
{
    if (g_safe) return;
    g_safe = true;
    actuator_disable_all();
    fault_output_set(true);
}

/**
 * @unit    SWU-SAF-006
 * @name    safety_is_safe_state
 * @type    function
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-007
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Returns true when system is in safe state.
 */
bool safety_is_safe_state(void) { return g_safe; }