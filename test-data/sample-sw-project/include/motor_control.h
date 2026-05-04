/**
 * motor_control.h — Motor Control public API
 */
#ifndef MOTOR_CONTROL_H
#define MOTOR_CONTROL_H

#include <stdbool.h>

int   motor_init(void);
void  motor_set_speed(float rpm);
void  motor_run(float current_rpm, float dt);
void  motor_emergency_stop(void);
void  motor_enable(bool enable);

/* HAL stubs — implemented by BSP layer */
void     pwm_set_duty(unsigned char duty);

#endif /* MOTOR_CONTROL_H */
