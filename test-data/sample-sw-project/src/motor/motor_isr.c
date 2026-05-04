/**
 * @unit    SWU-MOT-002
 * @name    Motor ISR Handler
 * @type    isr
 * @asil    B
 * @sdd     SDD-MOT-002
 * @req     SWR-MOT-004, SWR-MOT-005
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Encoder quadrature ISR and PWM timer ISR for the motor control loop.
 */

#include "motor_control.h"
#include <stdint.h>
#include <stdbool.h>

/* ── Shared volatile state (ISR ↔ motor_control task) ───────────────────── */

#define PIN_ENC_A               0
#define PIN_ENC_B               1
#define PWM_MAX_DUTY            1000
#define OVERCURRENT_THRESHOLD_MA 10000   /* 10 A — hardware OC limit */

volatile int32_t  g_encoder_count = 0;
volatile int32_t  g_encoder_delta = 0;
volatile uint16_t g_pwm_duty      = 0;
volatile bool     g_overcurrent   = false;

/* Gray-code quadrature transition table.
 * Index = (prev_B<<3)|(prev_A<<2)|(cur_B<<1)|(cur_A).
 * +1 = forward, -1 = reverse, 0 = no change, 2 = illegal glitch. */
static const int8_t transition[16] = {
     0, +1, -1,  0,
    -1,  0,  0, +1,
    +1,  0,  0, -1,
     0, -1, +1,  0
};

static uint8_t g_enc_prev_state = 0u;   /* last two channel levels */

/* ── encoder_read_pins (platform stub) ───────────────────────────────────── */
static inline uint8_t encoder_read_pins(void)
{
    /* Returns bit0=ENC_A, bit1=ENC_B from GPIO IDR */
    extern uint32_t gpio_read_port(void);
    uint32_t port = gpio_read_port();
    return (uint8_t)((port >> PIN_ENC_A) & 0x03u);
}

/* ── ENCODER_IRQHandler ───────────────────────────────────────────────────── */
void ENCODER_IRQHandler(void)
{
    uint8_t cur  = encoder_read_pins();              /* read A and B levels */
    uint8_t idx  = (g_enc_prev_state << 2u) | cur;  /* 4-bit index into table */
    int8_t  step = transition[idx & 0x0Fu];

    if (step != 0) {
        g_encoder_count += (int32_t)step;
        g_encoder_delta += (int32_t)step;
    }
    g_enc_prev_state = cur;
}

/* ── TIM1_UP_IRQHandler ───────────────────────────────────────────────────── */
void TIM1_UP_IRQHandler(void)
{
    extern uint16_t adc_read_current_ma(void);
    extern void     tim1_clear_uif(void);

    tim1_clear_uif();   /* clear update interrupt flag first */

    uint16_t i_ma = adc_read_current_ma();
    if (i_ma > OVERCURRENT_THRESHOLD_MA) {
        g_overcurrent = true;
        g_pwm_duty    = 0u;     /* immediate hardware cut-off */
    }

    /* Write shadow register — actual reload on next timer period */
    extern void tim1_set_ccr1(uint16_t v);
    tim1_set_ccr1(g_pwm_duty);
}

/* ── encoder_consume_delta ────────────────────────────────────────────────── */
int32_t encoder_consume_delta(void)
{
    extern void disable_irq(void);
    extern void enable_irq(void);

    disable_irq();
    int32_t delta   = g_encoder_delta;
    g_encoder_delta = 0;
    enable_irq();
    return delta;
}
