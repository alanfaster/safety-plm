/**
 * @unit    SWU-SAF-001
 * @name    Safety Monitor
 * @type    state_machine
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-001, SWR-SAF-002, SWR-SAF-003, SWR-SAF-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Central safety supervision — watchdog, temperature, voltage rail supervisor.
 */

#include "safety_monitor.h"
#include "temperature_sensor.h"
#include <stdint.h>
#include <stdbool.h>
#include <string.h>

#define SAFETY_LOG_SIZE     32
#define WATCHDOG_TIMEOUT_MS 50
#define VBAT_MIN_MV         10800  /* 10.8 V minimum battery voltage */

typedef struct {
    SafetyEvent_t event;
    uint32_t      timestamp_ms;
} SafetyLogEntry_t;

static SafetyLogEntry_t g_safety_log[SAFETY_LOG_SIZE];
static uint8_t          g_log_head   = 0;
static bool             g_safe_state = false;
static float            g_temperature = 0.0f;

/**
 * @unit    SWU-SAF-001
 * @name    Safety Monitor
 * @type    state_machine
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-001, SWR-SAF-002, SWR-SAF-003, SWR-SAF-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Central safety supervision — watchdog, temperature, voltage rail supervisor.
 */
void safety_monitor_init(void) {
    memset(g_safety_log, 0, sizeof(g_safety_log));
    g_log_head   = 0;
    g_safe_state = false;
    watchdog_init(WATCHDOG_TIMEOUT_MS);
}

/**
 * @unit    SWU-SAF-001
 * @name    Safety Monitor
 * @type    state_machine
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-001, SWR-SAF-002, SWR-SAF-003, SWR-SAF-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Central safety supervision — watchdog, temperature, voltage rail supervisor.
 */
void safety_monitor_tick(void) {
    watchdog_kick();

    /* Temperature check */
    g_temperature = temperature_read_celsius();
    if (g_temperature > 95.0f) {
        safety_log_event(SAFETY_EVENT_OVER_TEMP);
        safety_enter_safe_state();
    }

    /* Battery voltage check */
    uint32_t vbat_mv = adc_read_vbat_mv();
    if (vbat_mv < VBAT_MIN_MV) {
        safety_log_event(SAFETY_EVENT_UNDERVOLTAGE);
        safety_enter_safe_state();
    }
}

/**
 * @unit    SWU-SAF-001
 * @name    Safety Monitor
 * @type    state_machine
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-001, SWR-SAF-002, SWR-SAF-003, SWR-SAF-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Central safety supervision — watchdog, temperature, voltage rail supervisor.
 */
void safety_log_event(SafetyEvent_t event) {
    g_safety_log[g_log_head].event        = event;
    g_safety_log[g_log_head].timestamp_ms = system_get_tick_ms();
    g_log_head = (g_log_head + 1) % SAFETY_LOG_SIZE;
}

/**
 * @unit    SWU-SAF-001
 * @name    Safety Monitor
 * @type    state_machine
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-001, SWR-SAF-002, SWR-SAF-003, SWR-SAF-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Central safety supervision — watchdog, temperature, voltage rail supervisor.
 */
float safety_get_temperature(void) {
    return g_temperature;
}

/**
 * @unit    SWU-SAF-001
 * @name    Safety Monitor
 * @type    state_machine
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-001, SWR-SAF-002, SWR-SAF-003, SWR-SAF-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Central safety supervision — watchdog, temperature, voltage rail supervisor.
 */
void safety_enter_safe_state(void) {
    if (g_safe_state) return;  /* Already in safe state */
    g_safe_state = true;
    actuator_disable_all();
    fault_output_set(true);
}

/**
 * @unit    SWU-SAF-001
 * @name    Safety Monitor
 * @type    state_machine
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-001, SWR-SAF-002, SWR-SAF-003, SWR-SAF-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Central safety supervision — watchdog, temperature, voltage rail supervisor.
 */
bool safety_is_safe_state(void) {
    return g_safe_state;
}
