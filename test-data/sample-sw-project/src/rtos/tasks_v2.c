/**
 * @unit    SWU-RTOS-001
 * @name    RTOS Application Tasks
 * @type    task
 * @asil    B
 * @sdd     SDD-RTOS-001
 * @req     SWR-RTOS-001, SWR-RTOS-002, SWR-RTOS-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  in_review
 *
 * v2: stack sizes increased, safety_log_event added for undervoltage.
 */

#include "FreeRTOS.h"
#include "task.h"
#include "motor_control.h"
#include "safety_monitor.h"
#include <stdint.h>
#include <stdbool.h>

#define MOTOR_TASK_STACK    384     /* ECR-2024-041: increased from 256 — trace buffer added */
#define SAFETY_TASK_STACK   256     /* ECR-2024-041: increased from 192 — log buffer added  */
#define MOTOR_PRIO          4u
#define SAFETY_PRIO         5u

#define MOTOR_PERIOD_MS     1u
#define SAFETY_PERIOD_MS    10u

#define VBAT_UNDERVOLT_MV   10500u  /* minimum acceptable battery voltage */

extern int32_t encoder_consume_delta(void);
extern void    watchdog_kick(void);
extern float   speed_sensor_read_rpm(void);
extern uint16_t adc_read_vbat_mv(void);

/* ── Static TCB and stack storage ────────────────────────────────────────── */
static StaticTask_t  motor_tcb;
static StackType_t   motor_stack[MOTOR_TASK_STACK];

static StaticTask_t  safety_tcb;
static StackType_t   safety_stack[SAFETY_TASK_STACK];

/* ── motor_task ───────────────────────────────────────────────────────────── */
static void motor_task(void *arg)
{
    (void)arg;
    const TickType_t period  = pdMS_TO_TICKS(MOTOR_PERIOD_MS);
    TickType_t       wake_at = xTaskGetTickCount();

    for (;;) {
        vTaskDelayUntil(&wake_at, period);

        if (safety_is_safe_state()) {
            motor_emergency_stop();
            continue;
        }

        int32_t delta       = encoder_consume_delta();
        float   current_rpm = speed_sensor_read_rpm();

        motor_run(current_rpm, (float)MOTOR_PERIOD_MS / 1000.0f);
        (void)delta;
    }
}

/* ── safety_task ──────────────────────────────────────────────────────────── */
static void safety_task(void *arg)
{
    (void)arg;
    const TickType_t period  = pdMS_TO_TICKS(SAFETY_PERIOD_MS);
    TickType_t       wake_at = xTaskGetTickCount();

    for (;;) {
        vTaskDelayUntil(&wake_at, period);

        safety_monitor_tick();

        /* ECR-2024-043: log undervoltage event before kicking watchdog */
        if (adc_read_vbat_mv() < VBAT_UNDERVOLT_MV) {
            safety_log_event(SAFETY_EVENT_UNDERVOLTAGE);
        }

        watchdog_kick();
    }
}

/* ── tasks_create_all ─────────────────────────────────────────────────────── */
void tasks_create_all(void)
{
    xTaskCreateStatic(motor_task,
                      "motor",
                      MOTOR_TASK_STACK,
                      NULL,
                      MOTOR_PRIO,
                      motor_stack,
                      &motor_tcb);

    xTaskCreateStatic(safety_task,
                      "safety",
                      SAFETY_TASK_STACK,
                      NULL,
                      SAFETY_PRIO,
                      safety_stack,
                      &safety_tcb);
}
