/**
 * @unit    SWU-MOT-002
 * @name    Motor ISR Handler
 * @type    isr
 * @asil    B
 * @sdd     SDD-MOT-002
 * @req     SWR-MOT-004, SWR-MOT-005
 * @author  A. Guerrero
 * @language c
 *
 * Encoder quadrature ISR and PWM timer ISR for the motor control loop.
 * Both ISRs share a volatile state block; access from non-ISR context
 * must be protected with interrupt disable/enable guards.
 */

#include "motor_control.h"
#include <stdint.h>
#include <stdbool.h>

/* ── Shared volatile state (ISR ↔ motor_control task) ────────────────────── */

volatile uint32_t g_encoder_ticks   = 0;
volatile int32_t  g_encoder_delta   = 0;   /* ticks since last sample */
volatile uint16_t g_pwm_duty        = 0;   /* 0–1000 = 0–100 % */
volatile bool     g_overcurrent_flag = false;

/* ── Encoder quadrature ISR (EXTI line — rising + falling edge on A/B) ───── */

void ENCODER_IRQHandler(void)
{
    static uint8_t last_ab = 0;
    uint8_t a = (GPIOA->IDR >> PIN_ENC_A) & 1u;
    uint8_t b = (GPIOA->IDR >> PIN_ENC_B) & 1u;
    uint8_t ab = (a << 1) | b;

    /* Gray-code transition table: index = (last<<2)|current */
    static const int8_t transition[16] = {
         0, -1, +1,  0,
        +1,  0,  0, -1,
        -1,  0,  0, +1,
         0, +1, -1,  0,
    };

    int8_t dir = transition[(last_ab << 2) | ab];
    g_encoder_ticks += (uint32_t)dir;
    g_encoder_delta += dir;
    last_ab = ab;

    EXTI->PR = EXTI_PR_ENC_MASK;  /* clear pending bits */
}

/* ── PWM timer ISR (TIM1 update — fires at 20 kHz) ──────────────────────── */

void TIM1_UP_IRQHandler(void)
{
    TIM1->SR &= ~TIM_SR_UIF;  /* clear update interrupt flag */

    /* Read current sense ADC (injected conversion, already done by HW) */
    uint16_t adc_cs = ADC1->JDR1;
    /* 1 LSB ≈ 0.8 mA — threshold at 10 A = 12500 LSB */
    if (adc_cs > 12500u) {
        g_overcurrent_flag = true;
        TIM1->BDTR &= ~TIM_BDTR_MOE;  /* disable main output — break */
    }

    /* Update PWM compare register from shared duty word */
    TIM1->CCR1 = g_pwm_duty;
}

/* ── Helper: safely read encoder delta and reset it ─────────────────────── */

int32_t encoder_consume_delta(void)
{
    __disable_irq();
    int32_t delta = g_encoder_delta;
    g_encoder_delta = 0;
    __enable_irq();
    return delta;
}
