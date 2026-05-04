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

#define WATCHDOG_MS     50u     /* watchdog kick period */
#define VBAT_MIN_MV     10500u  /* minimum acceptable bus voltage (mV) */
#define TEMP_CRIT       95.0f   /* hard thermal limit — enters safe state */
#define LOG_SIZE        16u     /* ring-buffer depth */

extern void     watchdog_init(void);
extern void     motor_emergency_stop(void);
extern uint32_t sys_get_tick_ms(void);
extern uint16_t adc_read_vbat_mv(void);
extern void     fault_output_set(bool active);

typedef struct {
    SafetyEvent_t event;
    uint32_t      ts;
} LogEntry_t;

static LogEntry_t g_log[LOG_SIZE];
static uint8_t    g_head;
static bool       g_safe;
static float      g_temp;

/* ── safety_monitor_init ─────────────────────────────────────────────────── */
void safety_monitor_init(void)
{
    memset(g_log, 0, sizeof(g_log));
    g_head = 0u;
    g_safe = false;
    g_temp = 0.0f;
    watchdog_init();
}

/* ── safety_monitor_tick ─────────────────────────────────────────────────── */
void safety_monitor_tick(void)
{
    /* Read and cache temperature */
    g_temp = temperature_read_celsius();

    if (g_temp >= TEMP_CRIT) {
        safety_log_event(SAFETY_EVENT_OVER_TEMP);
        safety_enter_safe_state();
    }

    /* Check supply voltage */
    uint16_t vbat = adc_read_vbat_mv();
    if (vbat < (uint16_t)VBAT_MIN_MV) {
        safety_log_event(SAFETY_EVENT_UNDERVOLTAGE);
        safety_enter_safe_state();
    }
}

/* ── safety_log_event ────────────────────────────────────────────────────── */
void safety_log_event(SafetyEvent_t e)
{
    g_log[g_head].event = e;
    g_log[g_head].ts    = sys_get_tick_ms();
    g_head = (uint8_t)((g_head + 1u) % LOG_SIZE);   /* ring-buffer wrap */
}

/* ── safety_get_temperature ──────────────────────────────────────────────── */
float safety_get_temperature(void)
{
    return g_temp;
}

/* ── safety_enter_safe_state ─────────────────────────────────────────────── */
void safety_enter_safe_state(void)
{
    if (g_safe) return;   /* guard re-entry */
    g_safe = true;
    motor_emergency_stop();   /* disable all actuators */
    fault_output_set(true);   /* assert external fault line */
}

/* ── safety_is_safe_state ────────────────────────────────────────────────── */
bool safety_is_safe_state(void)
{
    return g_safe;
}
