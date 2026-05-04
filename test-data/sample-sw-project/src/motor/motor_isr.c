#include "motor_control.h"
#include <stdint.h>
#include <stdbool.h>

#define OVERCURRENT_LIMIT 12500u  /* ~10 A in ADC counts */
static const int8_t transition[16] = {0,-1,+1,0,+1,0,0,-1,-1,0,0,+1,0,+1,-1,0};
volatile int32_t  g_encoder_delta  = 0;
volatile uint16_t g_pwm_duty       = 0;
volatile bool     g_overcurrent    = false;
extern uint16_t ADC1_JDR1;

/**
 * @unit    SWU-ISR-001
 * @name    ENCODER_IRQHandler
 * @type    isr
 * @asil    B
 * @sdd     SDD-MOT-003
 * @req     SWR-ISR-001
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Quadrature encoder ISR — decodes A/B edges via Gray-code table.
 */
void ENCODER_IRQHandler(void)
{
    static uint8_t last_ab = 0;
    uint8_t a  = (GPIOA_IDR >> 0) & 1u;
    uint8_t b  = (GPIOA_IDR >> 1) & 1u;
    uint8_t ab = (uint8_t)((a << 1) | b);
    g_encoder_delta += transition[(last_ab << 2) | ab];
    last_ab = ab;
    EXTI_PR = (1u << 0) | (1u << 1);
}

/**
 * @unit    SWU-ISR-002
 * @name    TIM1_UP_IRQHandler
 * @type    isr
 * @asil    B
 * @sdd     SDD-MOT-003
 * @req     SWR-ISR-002, SWR-ISR-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * PWM timer update ISR — checks overcurrent and updates CCR1 from shared duty word.
 */
void TIM1_UP_IRQHandler(void)
{
    TIM1_SR &= ~(1u);  /* clear UIF */
    if (ADC1_JDR1 > OVERCURRENT_LIMIT) {
        g_overcurrent = true;
        TIM1_BDTR    &= ~(1u << 15);  /* disable MOE */
    }
    TIM1_CCR1 = g_pwm_duty;
}

/**
 * @unit    SWU-ISR-003
 * @name    encoder_consume_delta
 * @type    function
 * @asil    B
 * @sdd     SDD-MOT-003
 * @req     SWR-ISR-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Atomically reads and resets the encoder delta counter.
 */
int32_t encoder_consume_delta(void)
{
    __disable_irq();
    int32_t d = g_encoder_delta;
    g_encoder_delta = 0;
    __enable_irq();
    return d;
}