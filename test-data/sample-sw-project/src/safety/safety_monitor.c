/**
 * safety_monitor.c
 * SW Unit: Safety Monitor
 * Description: Central safety supervision — monitors watchdog, temperature,
 *              voltage rail and transitions system to SAFE state on fault.
 * ASIL: B
 * Linked SDD: SDD-SAF-001
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
 * safety_monitor_init - Initialise safety subsystem.
 */
void safety_monitor_init(void) {
    memset(g_safety_log, 0, sizeof(g_safety_log));
    g_log_head   = 0;
    g_safe_state = false;
    watchdog_init(WATCHDOG_TIMEOUT_MS);
}

/**
 * safety_monitor_tick - Periodic supervision (call at 100 Hz).
 * Checks: watchdog, temperature, battery voltage.
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
 * safety_log_event - Record a safety event with timestamp.
 */
void safety_log_event(SafetyEvent_t event) {
    g_safety_log[g_log_head].event        = event;
    g_safety_log[g_log_head].timestamp_ms = system_get_tick_ms();
    g_log_head = (g_log_head + 1) % SAFETY_LOG_SIZE;
}

/**
 * safety_get_temperature - Return last measured temperature.
 */
float safety_get_temperature(void) {
    return g_temperature;
}

/**
 * safety_enter_safe_state - Transition system to SAFE state.
 * Disables all actuators and signals fault to supervisor.
 */
void safety_enter_safe_state(void) {
    if (g_safe_state) return;  /* Already in safe state */
    g_safe_state = true;
    actuator_disable_all();
    fault_output_set(true);
}

/**
 * safety_is_safe_state - Returns true if system is in SAFE state.
 */
bool safety_is_safe_state(void) {
    return g_safe_state;
}
