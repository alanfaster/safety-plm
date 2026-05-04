/**
 * @unit    SWU-MOT-001
 * @name    Motor Control
 * @type    function
 * @asil    B
 * @sdd     SDD-MOT-001
 * @req     SWR-MOT-001, SWR-MOT-002, SWR-MOT-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Controls the brushless DC motor speed and direction.
 * Implements PID regulation and safety cut-off.
 */

#include "motor_control.h"
#include "safety_monitor.h"
#include <stdint.h>
#include <stdbool.h>

#define PID_KP              1.2f
#define PID_KI              0.05f
#define PID_KD              0.01f
#define MOTOR_MAX_RPM       8000
#define MOTOR_MIN_RPM       0
#define OVER_TEMP_THRESHOLD 85.0f   /* emergency thermal cut-off in °C */
#define PWM_DUTY_MAX        1000u   /* timer ARR — maps to 100 % duty */

extern void pwm_set_duty(uint16_t duty);

typedef struct {
    float setpoint;
    float integral;
    float prev_error;
    bool  enabled;
} MotorCtx_t;

static MotorCtx_t g_motor;

/* ── motor_init ───────────────────────────────────────────────────────────── */
void motor_init(void)
{
    g_motor.setpoint   = 0.0f;
    g_motor.integral   = 0.0f;
    g_motor.prev_error = 0.0f;
    g_motor.enabled    = false;
    pwm_set_duty(0);
}

/* ── motor_set_speed ──────────────────────────────────────────────────────── */
void motor_set_speed(float rpm)
{
    if (rpm < (float)MOTOR_MIN_RPM) rpm = (float)MOTOR_MIN_RPM;
    if (rpm > (float)MOTOR_MAX_RPM) rpm = (float)MOTOR_MAX_RPM;
    g_motor.setpoint = rpm;
    g_motor.enabled  = (rpm > 0.0f);
}

/* ── motor_run ────────────────────────────────────────────────────────────── */
void motor_run(float current_rpm, float dt)
{
    if (!g_motor.enabled) return;

    if (safety_get_temperature() > OVER_TEMP_THRESHOLD) {
        motor_emergency_stop();
        return;
    }

    float error        = g_motor.setpoint - current_rpm;
    g_motor.integral  += error * dt;
    float derivative   = (dt > 0.0f) ? ((error - g_motor.prev_error) / dt) : 0.0f;
    g_motor.prev_error = error;

    float output = PID_KP * error
                 + PID_KI * g_motor.integral
                 + PID_KD * derivative;

    if (output < 0.0f)   output = 0.0f;
    if (output > 100.0f) output = 100.0f;

    uint16_t duty = (uint16_t)((output / 100.0f) * (float)PWM_DUTY_MAX);
    pwm_set_duty(duty);
}

/* ── motor_emergency_stop ─────────────────────────────────────────────────── */
void motor_emergency_stop(void)
{
    g_motor.enabled    = false;
    g_motor.setpoint   = 0.0f;
    g_motor.integral   = 0.0f;
    g_motor.prev_error = 0.0f;
    pwm_set_duty(0);
    safety_log_event(SAFETY_EVENT_MOTOR_ESTOP);
}

/* ── motor_is_running ─────────────────────────────────────────────────────── */
bool motor_is_running(void)
{
    return g_motor.enabled && (g_motor.setpoint > 0.0f);
}
