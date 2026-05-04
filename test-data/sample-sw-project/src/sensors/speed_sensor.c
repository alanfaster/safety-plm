/**
 * @unit    SWU-SEN-001
 * @name    Speed Sensor Driver
 * @type    function
 * @asil    B
 * @sdd     SDD-SEN-001
 * @req     SWR-SEN-001, SWR-SEN-002
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Reads quadrature encoder pulses and computes RPM.
 */

#include "speed_sensor.h"
#include <stdint.h>

#define ENCODER_PPR         1024u   /* pulses per revolution */
#define SAMPLE_PERIOD_MS    10u     /* sampling period — must match task period */
#define RPM_FILTER_ALPHA    0.8f    /* IIR low-pass: higher = smoother */

/* Precomputed: (60 * 1000) / (PPR * SAMPLE_MS) = 60000 / 10240 */
#define RPM_SCALE_FACTOR    ((60.0f * 1000.0f) / ((float)ENCODER_PPR * (float)SAMPLE_PERIOD_MS))

extern void     encoder_hw_init(void);
extern void     encoder_reset_count(void);
extern uint32_t encoder_read_count(void);

static uint32_t g_prev_count = 0u;
static float    g_rpm        = 0.0f;

/* ── speed_sensor_init ────────────────────────────────────────────────────── */
void speed_sensor_init(void)
{
    g_prev_count = 0u;
    g_rpm        = 0.0f;
    encoder_hw_init();
}

/* ── speed_sensor_read_rpm ────────────────────────────────────────────────── */
float speed_sensor_read_rpm(void)
{
    uint32_t cur_count = encoder_read_count();

    /* Handle 32-bit wrap-around gracefully */
    uint32_t delta = cur_count - g_prev_count;   /* unsigned subtraction wraps correctly */
    g_prev_count   = cur_count;

    float raw_rpm = (float)delta * RPM_SCALE_FACTOR;

    /* First-order IIR low-pass filter */
    g_rpm = RPM_FILTER_ALPHA * g_rpm + (1.0f - RPM_FILTER_ALPHA) * raw_rpm;

    return g_rpm;
}

/* ── speed_sensor_reset ───────────────────────────────────────────────────── */
void speed_sensor_reset(void)
{
    g_prev_count = 0u;
    g_rpm        = 0.0f;
    encoder_reset_count();
}

/* ── speed_sensor_is_stalled ──────────────────────────────────────────────── */
bool speed_sensor_is_stalled(float min_rpm)
{
    return g_rpm < min_rpm;
}
