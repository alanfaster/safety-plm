/**
 * @unit    SWU-SAF-001-H
 * @name    Safety Monitor API Header
 * @type    general
 * @asil    B
 * @sdd     SDD-SAF-001
 * @req     SWR-SAF-001
 * @author  A. Guerrero
 * @language c
 */
#ifndef SAFETY_MONITOR_H
#define SAFETY_MONITOR_H

#include <stdbool.h>

typedef enum {
    SAFETY_EVENT_MOTOR_ESTOP   = 0x01,
    SAFETY_EVENT_OVER_TEMP     = 0x02,
    SAFETY_EVENT_UNDERVOLTAGE  = 0x03,
    SAFETY_EVENT_WATCHDOG      = 0x04,
} SafetyEvent_t;

void  safety_monitor_init(void);
void  safety_monitor_tick(void);
void  safety_log_event(SafetyEvent_t event);
float safety_get_temperature(void);
void  safety_enter_safe_state(void);
bool  safety_is_safe_state(void);

/* HAL stubs */
void     watchdog_init(unsigned int timeout_ms);
void     watchdog_kick(void);
void     actuator_disable_all(void);
void     fault_output_set(bool active);
unsigned int system_get_tick_ms(void);
unsigned int adc_read_vbat_mv(void);

#endif /* SAFETY_MONITOR_H */
