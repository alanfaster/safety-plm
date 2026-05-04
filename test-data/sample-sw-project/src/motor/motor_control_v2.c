/**
 * motor_control.c  — VERSION 2 (modified for drift detection test)
 * Changes vs v1:
 *   - PID_KP changed from 1.2 to 1.5 (tuning)
 *   - OVER_TEMP_THRESHOLD raised from 85 to 90
 *   - motor_run: added anti-windup on integral
 *   - motor_emergency_stop: added FAULT LED output
 *
 * RENAME THIS FILE TO motor_control.c WHEN UPLOADING THE SECOND ZIP
 */

#include "motor_control.h"
#include "safety_monitor.h"
#include "fault_led.h"
#include <stdint.h>
#include <stdbool.h>

#define MOTOR_MAX_RPM       8000
#define MOTOR_MIN_RPM       0
#define PID_KP              1.5f   /* CHANGED: 1.2 -> 1.5 */
#define PID_KI              0.05f
#define PID_KD              0.01f
#define OVER_TEMP_THRESHOLD 90     /* CHANGED: 85 -> 90 */
#define INTEGRAL_LIMIT      500.0f /* NEW: anti-windup clamp */

typedef struct {
    float setpoint;
    float integral;
    float prev_error;
    bool  enabled;
} MotorState_t;

static MotorState_t g_motor = { 0.0f, 0.0f, 0.0f, false };

int motor_init(void) {
    g_motor.setpoint   = 0.0f;
    g_motor.integral   = 0.0f;
    g_motor.prev_error = 0.0f;
    g_motor.enabled    = false;
    return 0;
}

void motor_set_speed(float rpm) {
    if (rpm < MOTOR_MIN_RPM) rpm = MOTOR_MIN_RPM;
    if (rpm > MOTOR_MAX_RPM) rpm = MOTOR_MAX_RPM;
    g_motor.setpoint = rpm;
}

void motor_run(float current_rpm, float dt) {
    if (!g_motor.enabled) return;

    float error    = g_motor.setpoint - current_rpm;
    g_motor.integral += error * dt;

    /* Anti-windup clamp — NEW */
    if (g_motor.integral >  INTEGRAL_LIMIT) g_motor.integral =  INTEGRAL_LIMIT;
    if (g_motor.integral < -INTEGRAL_LIMIT) g_motor.integral = -INTEGRAL_LIMIT;

    float derivative   = (error - g_motor.prev_error) / dt;
    g_motor.prev_error = error;

    float output = PID_KP * error
                 + PID_KI * g_motor.integral
                 + PID_KD * derivative;

    if (output < 0.0f)   output = 0.0f;
    if (output > 100.0f) output = 100.0f;

    if (safety_get_temperature() > OVER_TEMP_THRESHOLD) {
        motor_emergency_stop();
        return;
    }

    pwm_set_duty((uint8_t)output);
}

void motor_emergency_stop(void) {
    g_motor.enabled  = false;
    g_motor.setpoint = 0.0f;
    g_motor.integral = 0.0f;
    pwm_set_duty(0);
    fault_led_set(true);   /* NEW: illuminate fault LED */
    safety_log_event(SAFETY_EVENT_MOTOR_ESTOP);
}

void motor_enable(bool enable) {
    g_motor.enabled = enable;
    if (!enable) {
        pwm_set_duty(0);
    }
}
