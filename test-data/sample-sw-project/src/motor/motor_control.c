/**
 * @unit    SWU-MOT-001
 * @name    Motor PID Control
 * @type    function
 * @asil    B
 * @sdd     SDD-MOT-001
 * @req     SWR-MOT-001, SWR-MOT-002
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * PID speed controller for the BLDC motor.
 * Reads current RPM, computes PID output, drives PWM duty cycle.
 */

#include "motor_control.h"
#include "safety_monitor.h"
#include <stdint.h>
#include <stdbool.h>

#define PID_KP              1.2f
#define PID_KI              0.05f
#define PID_KD              0.01f
#define MOTOR_MAX_RPM       8000
#define OVER_TEMP_THRESHOLD 85.0f
#define PWM_DUTY_MAX        1000u

extern void pwm_set_duty(uint16_t duty);

typedef struct {
    float setpoint;
    float integral;
    float prev_error;
    bool  enabled;
} MotorCtx_t;

static MotorCtx_t g_motor;

void motor_init(void)
{
    g_motor.setpoint   = 0.0f;
    g_motor.integral   = 0.0f;
    g_motor.prev_error = 0.0f;
    g_motor.enabled    = false;
    pwm_set_duty(0);
}

void motor_set_speed(float rpm)
{
    if (rpm < 0.0f)                  rpm = 0.0f;
    if (rpm > (float)MOTOR_MAX_RPM)  rpm = (float)MOTOR_MAX_RPM;
    g_motor.setpoint = rpm;
    g_motor.enabled  = (rpm > 0.0f);
}

void motor_run(float current_rpm, float dt)
{
    if (!g_motor.enabled) return;

    if (safety_get_temperature() > OVER_TEMP_THRESHOLD) {
        motor_emergency_stop();
        return;
    }

    float error       = g_motor.setpoint - current_rpm;
    g_motor.integral += error * dt;
    float derivative  = (dt > 0.0f) ? ((error - g_motor.prev_error) / dt) : 0.0f;
    g_motor.prev_error = error;

    float output = PID_KP * error + PID_KI * g_motor.integral + PID_KD * derivative;
    if (output < 0.0f)   output = 0.0f;
    if (output > 100.0f) output = 100.0f;

    pwm_set_duty((uint16_t)((output / 100.0f) * (float)PWM_DUTY_MAX));
}

bool motor_is_running(void)
{
    return g_motor.enabled && (g_motor.setpoint > 0.0f);
}

/**
 * @unit    SWU-MOT-002
 * @name    Motor Emergency Stop
 * @type    function
 * @asil    B
 * @sdd     SDD-MOT-002
 * @req     SWR-MOT-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Immediately cuts motor output and logs the ESTOP safety event.
 * Called on over-temperature, overcurrent, or external command.
 */
void motor_emergency_stop(void)
{
    g_motor.enabled    = false;
    g_motor.setpoint   = 0.0f;
    g_motor.integral   = 0.0f;
    g_motor.prev_error = 0.0f;
    pwm_set_duty(0);
    safety_log_event(SAFETY_EVENT_MOTOR_ESTOP);
}
