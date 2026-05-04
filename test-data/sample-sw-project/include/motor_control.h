/**
 * @unit    SWU-MOT-001-H
 * @name    Motor Control API Header
 * @type    general
 * @sdd     SDD-MOT-001
 * @req     SWR-MOT-001
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Public API for the motor control module.
 */
#ifndef MOTOR_CONTROL_H
#define MOTOR_CONTROL_H

#include <stdbool.h>

int   motor_init(void);
void  motor_set_speed(float rpm);
void  motor_run(float current_rpm, float dt);
void  motor_emergency_stop(void);
void  motor_enable(bool enable);

/* HAL stubs â€” implemented by BSP layer */
void     pwm_set_duty(unsigned char duty);

#endif /* MOTOR_CONTROL_H */
