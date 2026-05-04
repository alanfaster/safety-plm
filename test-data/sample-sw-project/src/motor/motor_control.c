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

typedef struct { float setpoint; float integral; float prev_error; bool enabled; } MotorCtx_t;
static MotorCtx_t g_motor;
extern void pwm_set_duty(uint16_t duty);

/**
 * @unit    SWU-MOT-001
 * @name    motor_init
 * @type    function
 * @asil    B
 * @sdd     SDD-MOT-001
 * @req     SWR-MOT-001
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Initialises motor context and sets PWM output to zero.
 */
void motor_init(void)
{
    g_motor.setpoint = g_motor.integral = g_motor.prev_error = 0.0f;
    g_motor.enabled  = false;
    pwm_set_duty(0);
}

/**
 * @unit    SWU-MOT-002
 * @name    motor_set_speed
 * @type    function
 * @asil    B
 * @sdd     SDD-MOT-001
 * @req     SWR-MOT-002
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Clamps requested RPM to [0, MAX] and stores as PID setpoint.
 */
void motor_set_speed(float rpm)
{
    if (rpm < 0.0f)                 rpm = 0.0f;
    if (rpm > (float)MOTOR_MAX_RPM) rpm = (float)MOTOR_MAX_RPM;
    g_motor.setpoint = rpm;
    g_motor.enabled  = (rpm > 0.0f);
}

/**
 * @unit    SWU-MOT-003
 * @name    motor_run
 * @type    function
 * @asil    B
 * @sdd     SDD-MOT-001
 * @req     SWR-MOT-003, SWR-MOT-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * PID step: computes control output from speed error and drives PWM.
 */
void motor_run(float current_rpm, float dt)
{
    if (!g_motor.enabled) return;
    if (safety_get_temperature() > OVER_TEMP_THRESHOLD) { motor_emergency_stop(); return; }
    float error = g_motor.setpoint - current_rpm;
    g_motor.integral += error * dt;
    float deriv = (dt > 0.0f) ? (error - g_motor.prev_error) / dt : 0.0f;
    g_motor.prev_error = error;
    float out = PID_KP * error + PID_KI * g_motor.integral + PID_KD * deriv;
    if (out < 0.0f) out = 0.0f; if (out > 100.0f) out = 100.0f;
    pwm_set_duty((uint16_t)(out / 100.0f * (float)PWM_DUTY_MAX));
}

/**
 * @unit    SWU-MOT-004
 * @name    motor_emergency_stop
 * @type    function
 * @asil    B
 * @sdd     SDD-MOT-002
 * @req     SWR-MOT-005
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Cuts PWM immediately, resets PID state, logs ESTOP event.
 */
void motor_emergency_stop(void)
{
    g_motor.setpoint = g_motor.integral = g_motor.prev_error = 0.0f;
    g_motor.enabled  = false;
    pwm_set_duty(0);
    safety_log_event(SAFETY_EVENT_MOTOR_ESTOP);
}

/**
 * @unit    SWU-MOT-005
 * @name    motor_is_running
 * @type    function
 * @asil    QM
 * @sdd     SDD-MOT-001
 * @req     SWR-MOT-006
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Returns true if motor is enabled and has a non-zero setpoint.
 */
bool motor_is_running(void)
{
    return g_motor.enabled && (g_motor.setpoint > 0.0f);
}