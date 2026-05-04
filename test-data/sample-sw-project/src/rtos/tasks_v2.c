#include "FreeRTOS.h"
#include "task.h"
#include "motor_control.h"
#include "safety_monitor.h"

#define MOTOR_STACK  384u
#define SAFETY_STACK 256u
#define MOTOR_PRIO     4u
#define SAFETY_PRIO    5u
#define MOTOR_MS       1u
#define SAFETY_MS     10u

static StaticTask_t _mt; static StackType_t _ms[MOTOR_STACK];
static StaticTask_t _st; static StackType_t _ss[SAFETY_STACK];

/**
 * @unit    SWU-TASK-001
 * @name    motor_task
 * @type    task
 * @asil    B
 * @sdd     SDD-RTOS-001
 * @req     SWR-TASK-001, SWR-TASK-002
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  in_review
 * 1 kHz FreeRTOS task — runs PID motor control loop.
 */
static void motor_task(void *arg)
{
    (void)arg;
    TickType_t w = xTaskGetTickCount();
    motor_init();
    for (;;) {
        vTaskDelayUntil(&w, pdMS_TO_TICKS(MOTOR_MS));
        if (safety_is_safe_state()) { motor_emergency_stop(); continue; }
        motor_run(encoder_consume_delta(), 0.001f);
    }
}

/**
 * @unit    SWU-TASK-002
 * @name    safety_task
 * @type    task
 * @asil    B
 * @sdd     SDD-RTOS-002
 * @req     SWR-TASK-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  in_review
 * 100 Hz FreeRTOS task — runs safety monitor and feeds watchdog.
 */
static void safety_task(void *arg)
{
    (void)arg;
    TickType_t w = xTaskGetTickCount();
    safety_monitor_init();
    watchdog_init(50u);
    for (;;) {
        vTaskDelayUntil(&w, pdMS_TO_TICKS(SAFETY_MS));
        safety_monitor_tick();
        if (adc_read_vbat_mv() < 10500u) safety_log_event(SAFETY_EVENT_UNDERVOLTAGE);
        watchdog_kick();
    }
}

/**
 * @unit    SWU-TASK-003
 * @name    tasks_create_all
 * @type    function
 * @asil    B
 * @sdd     SDD-RTOS-001
 * @req     SWR-TASK-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  in_review
 * Creates all application tasks before the FreeRTOS scheduler starts.
 */
void tasks_create_all(void)
{
    xTaskCreateStatic(motor_task,  "motor",  MOTOR_STACK,  NULL, MOTOR_PRIO,  _ms, &_mt);
    xTaskCreateStatic(safety_task, "safety", SAFETY_STACK, NULL, SAFETY_PRIO, _ss, &_st);
}