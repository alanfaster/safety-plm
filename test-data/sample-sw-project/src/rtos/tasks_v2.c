/**
 * @unit    SWU-RTOS-001
 * @name    RTOS Application Tasks
 * @type    task
 * @asil    B
 * @sdd     SDD-RTOS-001
 * @req     SWR-RTOS-001, SWR-RTOS-002, SWR-RTOS-003
 * @author  A. Guerrero
 * @language c
 *
 * FreeRTOS task definitions for the motor control application.
 * Contains motor_task (periodic control loop at 1 kHz) and
 * safety_task (watchdog feeder + voltage/temp supervisor at 100 Hz).
 * Both tasks share data with ISRs via volatile globals — see motor_isr.c.
 *
 * v2 changes:
 *   - MOTOR_TASK_STACK_SIZE increased 256 → 384 (stack overflow observed in test)
 *   - SAFETY_TASK_STACK_SIZE increased 192 → 256
 *   - safety_task now calls safety_log_event on undervoltage detection
 */

#include "FreeRTOS.h"
#include "task.h"
#include "motor_control.h"
#include "safety_monitor.h"
#include <stdint.h>
#include <stdbool.h>

/* ── Task configuration ──────────────────────────────────────────────────── */

#define MOTOR_TASK_STACK_SIZE   384u   /* words — increased from 256 (stack overflow fix) */
#define MOTOR_TASK_PRIORITY       4u
#define SAFETY_TASK_STACK_SIZE  256u   /* words — increased from 192 */
#define SAFETY_TASK_PRIORITY      5u   /* higher than motor: safety first */

#define MOTOR_TASK_PERIOD_MS      1u   /* 1 kHz */
#define SAFETY_TASK_PERIOD_MS    10u   /* 100 Hz */

static StaticTask_t  _motor_task_tcb;
static StackType_t   _motor_task_stack[MOTOR_TASK_STACK_SIZE];
static StaticTask_t  _safety_task_tcb;
static StackType_t   _safety_task_stack[SAFETY_TASK_STACK_SIZE];

/* ── Motor control task ──────────────────────────────────────────────────── */

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

/* ── Safety supervision task ─────────────────────────────────────────────── */

static void safety_task(void *arg)
{
    (void)arg;
    TickType_t last_wake = xTaskGetTickCount();

    safety_monitor_init();
    watchdog_init(50u);  /* 50 ms watchdog — safety_task feeds it every 10 ms */

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

/* ── Task creation (called from main before scheduler start) ─────────────── */

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
