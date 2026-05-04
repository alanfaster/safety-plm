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

/* â”€â”€ Task configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

#define MOTOR_TASK_STACK_SIZE   384u   /* words â€” increased from 256 (stack overflow fix) */
#define MOTOR_TASK_PRIORITY       4u
#define SAFETY_TASK_STACK_SIZE  256u   /* words â€” increased from 192 */
#define SAFETY_TASK_PRIORITY      5u   /* higher than motor: safety first */

#define MOTOR_TASK_PERIOD_MS      1u   /* 1 kHz */
#define SAFETY_TASK_PERIOD_MS    10u   /* 100 Hz */

static StaticTask_t  _motor_task_tcb;
static StackType_t   _motor_task_stack[MOTOR_TASK_STACK_SIZE];
static StaticTask_t  _safety_task_tcb;
static StackType_t   _safety_task_stack[SAFETY_TASK_STACK_SIZE];

/* â”€â”€ Motor control task â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

static void motor_task(void *arg)
{
    (void)arg;
    TickType_t last_wake = xTaskGetTickCount();

    motor_init();

    for (;;) {
        vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(MOTOR_TASK_PERIOD_MS));

        if (safety_is_safe_state()) {
            motor_emergency_stop();
            continue;
        }

        int32_t delta = encoder_consume_delta();
        motor_run(delta);
    }
}

/* â”€â”€ Safety supervision task â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

static void safety_task(void *arg)
{
    (void)arg;
    TickType_t last_wake = xTaskGetTickCount();

    safety_monitor_init();
    watchdog_init(50u);  /* 50 ms watchdog â€” safety_task feeds it every 10 ms */

    for (;;) {
        vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(SAFETY_TASK_PERIOD_MS));

        safety_monitor_tick();   /* checks temp, voltage, watchdog */

        /* Log undervoltage event explicitly for traceability */
        if (adc_read_vbat_mv() < 10500u) {
            safety_log_event(SAFETY_EVENT_UNDERVOLTAGE);
        }

        watchdog_kick();
    }
}

/* â”€â”€ Task creation (called from main before scheduler start) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

void tasks_create_all(void)
{
    xTaskCreateStatic(
        motor_task, "motor",
        MOTOR_TASK_STACK_SIZE, NULL, MOTOR_TASK_PRIORITY,
        _motor_task_stack, &_motor_task_tcb
    );
    xTaskCreateStatic(
        safety_task, "safety",
        SAFETY_TASK_STACK_SIZE, NULL, SAFETY_TASK_PRIORITY,
        _safety_task_stack, &_safety_task_tcb
    );
}
