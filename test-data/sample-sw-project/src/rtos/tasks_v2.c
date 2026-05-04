/**
 * @unit    SWU-RTOS-001
 * @name    Motor Control Task
 * @type    task
 * @asil    B
 * @sdd     SDD-RTOS-001
 * @req     SWR-RTOS-001, SWR-RTOS-002
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  in_review
 *
 * FreeRTOS task running the motor PID control loop at 1 kHz.
 */

#include "FreeRTOS.h"
#include "task.h"
#include "motor_control.h"
#include "safety_monitor.h"
#include <stdint.h>

#define MOTOR_TASK_STACK  384u
#define MOTOR_TASK_PRIO     4u
#define MOTOR_PERIOD_MS     1u

static StaticTask_t _motor_tcb;
static StackType_t  _motor_stack[MOTOR_TASK_STACK];

static void motor_task(void *arg)
{
    (void)arg;
    TickType_t wake = xTaskGetTickCount();
    motor_init();
    for (;;) {
        vTaskDelayUntil(&wake, pdMS_TO_TICKS(MOTOR_PERIOD_MS));
        if (safety_is_safe_state()) { motor_emergency_stop(); continue; }
        motor_run(encoder_consume_delta(), 0.001f);
    }
}

/**
 * @unit    SWU-RTOS-002
 * @name    Safety Supervision Task
 * @type    task
 * @asil    B
 * @sdd     SDD-RTOS-002
 * @req     SWR-RTOS-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  in_review
 *
 * FreeRTOS task running the safety monitor at 100 Hz.
 * Feeds the watchdog and checks temperature and voltage rails.
 */

#define SAFETY_TASK_STACK 256u
#define SAFETY_TASK_PRIO    5u
#define SAFETY_PERIOD_MS   10u

static StaticTask_t _safety_tcb;
static StackType_t  _safety_stack[SAFETY_TASK_STACK];

static void safety_task(void *arg)
{
    (void)arg;
    TickType_t wake = xTaskGetTickCount();
    safety_monitor_init();
    watchdog_init(50u);
    for (;;) {
        vTaskDelayUntil(&wake, pdMS_TO_TICKS(SAFETY_PERIOD_MS));
        safety_monitor_tick();
        if (adc_read_vbat_mv() < 10500u) safety_log_event(SAFETY_EVENT_UNDERVOLTAGE);
        watchdog_kick();
    }
}

void tasks_create_all(void)
{
    xTaskCreateStatic(motor_task,  "motor",  MOTOR_TASK_STACK,  NULL, MOTOR_TASK_PRIO,  _motor_stack,  &_motor_tcb);
    xTaskCreateStatic(safety_task, "safety", SAFETY_TASK_STACK, NULL, SAFETY_TASK_PRIO, _safety_stack, &_safety_tcb);
}