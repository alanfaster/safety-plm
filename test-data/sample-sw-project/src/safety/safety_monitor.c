/**
 * @unit    SWU-SAF-001
 * @name    Safety State Machine
 * @type    state_machine
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-001, SWR-SAF-002, SWR-SAF-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Central safety supervisor. Monitors temperature and voltage,
 * transitions system to SAFE state on fault detection.
 */

#include "safety_monitor.h"
#include "temperature_sensor.h"
#include <stdint.h>
#include <stdbool.h>

#define WATCHDOG_TIMEOUT_MS  50u
#define VBAT_MIN_MV       10500u
#define TEMP_CRIT_C         95.0f

static bool  g_safe  = false;
static float g_temp  = 0.0f;

void safety_monitor_init(void)
{
    g_safe = false;
    g_temp = 0.0f;
    watchdog_init(WATCHDOG_TIMEOUT_MS);
}

void safety_monitor_tick(void)
{
    watchdog_kick();
    g_temp = temperature_read_celsius();
    if (g_temp > TEMP_CRIT_C) {
        safety_log_event(SAFETY_EVENT_OVER_TEMP);
        safety_enter_safe_state();
    }
    if (adc_read_vbat_mv() < VBAT_MIN_MV) {
        safety_log_event(SAFETY_EVENT_UNDERVOLTAGE);
        safety_enter_safe_state();
    }
}

float safety_get_temperature(void) { return g_temp; }

void safety_enter_safe_state(void)
{
    if (g_safe) return;
    g_safe = true;
    actuator_disable_all();
    fault_output_set(true);
}

bool safety_is_safe_state(void) { return g_safe; }

/**
 * @unit    SWU-SAF-002
 * @name    Safety Event Logger
 * @type    general
 * @asil    B
 * @sdd     SDD-SAF-002
 * @req     SWR-SAF-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Ring-buffer event logger for safety-relevant events.
 * Stores the last 16 events with timestamps for post-mortem analysis.
 */

#define LOG_SIZE 16u

typedef struct { SafetyEvent_t event; uint32_t ts_ms; } LogEntry_t;

static LogEntry_t g_log[LOG_SIZE];
static uint8_t    g_head = 0;

void safety_log_event(SafetyEvent_t event)
{
    g_log[g_head].event  = event;
    g_log[g_head].ts_ms  = system_get_tick_ms();
    g_head = (uint8_t)((g_head + 1u) % LOG_SIZE);
}