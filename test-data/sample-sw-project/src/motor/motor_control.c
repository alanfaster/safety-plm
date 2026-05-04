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

#define MOTOR_MAX_RPM       8000
#define MOTOR_MIN_RPM       0
#define PID_KP              1.2f
#define PID_KI              0.05f
#define PID_KD              0.01f
#define OVER_TEMP_THRESHOLD 85  /* degrees Celsius */

typedef struct {
    float setpoint;
    float integral;
    float prev_error;
    bool  enabled;
} MotorState_t;

static MotorState_t g_motor = { 0.0f, 0.0f, 0.0f, false };

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
int motor_init(void) {
    g_motor.setpoint  = 0.0f;
    g_motor.integral  = 0.0f;
    g_motor.prev_error = 0.0f;
    g_motor.enabled   = false;
    /* TODO: initialise PWM peripheral */
    return 0;
}

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
void motor_set_speed(float rpm) {
    if (rpm < MOTOR_MIN_RPM) rpm = MOTOR_MIN_RPM;
    if (rpm > MOTOR_MAX_RPM) rpm = MOTOR_MAX_RPM;
    g_motor.setpoint = rpm;
}

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
void motor_run(float current_rpm, float dt) {
    if (!g_motor.enabled) return;

    float error    = g_motor.setpoint - current_rpm;
    g_motor.integral += error * dt;
    float derivative = (error - g_motor.prev_error) / dt;
    g_motor.prev_error = error;

    float output = PID_KP * error
                 + PID_KI * g_motor.integral
                 + PID_KD * derivative;

    /* Clamp PWM output to valid range [0, 100] */
    if (output < 0.0f)   output = 0.0f;
    if (output > 100.0f) output = 100.0f;

    /* Safety: cut off if over-temperature */
    if (safety_get_temperature() > OVER_TEMP_THRESHOLD) {
        motor_emergency_stop();
        return;
    }

    /* Write PWM duty cycle */
    pwm_set_duty((uint8_t)output);
}

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
void motor_emergency_stop(void) {
    g_motor.enabled  = false;
    g_motor.setpoint = 0.0f;
    g_motor.integral = 0.0f;
    pwm_set_duty(0);
    safety_log_event(SAFETY_EVENT_MOTOR_ESTOP);
}

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
void motor_enable(bool enable) {
    g_motor.enabled = enable;
    if (!enable) {
        pwm_set_duty(0);
    }
}
