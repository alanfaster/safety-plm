/**
 * @unit    SWU-CFG-001
 * @name    Motor Calibration & Thresholds
 * @type    calibration
 * @asil    B
 * @sdd     SDD-CFG-001
 * @req     SWR-CFG-001, SWR-CFG-002, SWR-CFG-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * PID gains, speed limits, safety thresholds, NTC lookup table.
 */

#include "motor_control.h"
#include "safety_monitor.h"
#include <stdint.h>

/* ── PID gains ───────────────────────────────────────────────────────────── */
const float    CAL_PID_KP      = 1.2f;
const float    CAL_PID_KI      = 0.05f;
const float    CAL_PID_KD      = 0.01f;

/* ── Speed limits ────────────────────────────────────────────────────────── */
const uint16_t CAL_MAX_RPM     = 8000u;
const uint16_t CAL_MIN_RPM     = 50u;
const uint16_t CAL_RAMP_STEP   = 200u;  /* RPM increments per ramp tick */

/* ── Thermal thresholds ──────────────────────────────────────────────────── */
const float    CAL_OVER_TEMP   = 85.0f;   /* emergency cut-off °C */
const float    CAL_WARN_TEMP   = 75.0f;   /* warning level °C */

/* ── Voltage rails ───────────────────────────────────────────────────────── */
const uint16_t CAL_UNDERVOLT_MV = 10500u; /* minimum bus voltage */
const uint16_t CAL_OVERVOLT_MV  = 15000u; /* maximum bus voltage */

/* ── Encoder resolution ──────────────────────────────────────────────────── */
const uint16_t CAL_ENC_PPR = 1024u;   /* pulses per revolution */

/* ── NTC temperature lookup (ADC counts @ 12-bit / 3.3 V ref) ──────────── */
/* Index 0 = -10 °C, step = 10 °C, index 13 = 120 °C                        */
const uint16_t CAL_NTC_ADC[14] = {
    3950, 3820, 3640, 3400, 3100,
    2760, 2390, 2020, 1680, 1380,
    1120,  900,  720,  580
};

const int8_t CAL_NTC_BASE = -10;   /* °C at index 0 */
const int8_t CAL_NTC_STEP =  10;   /* °C per index step */

/* ── cal_ntc_to_celsius ───────────────────────────────────────────────────── */
float cal_ntc_to_celsius(uint16_t adc)
{
    const uint8_t table_len = (uint8_t)(sizeof(CAL_NTC_ADC) / sizeof(CAL_NTC_ADC[0]));

    /* ADC value decreases as temperature rises — clamp to table edges */
    if (adc >= CAL_NTC_ADC[0]) {
        return (float)CAL_NTC_BASE;
    }
    if (adc <= CAL_NTC_ADC[table_len - 1u]) {
        return (float)CAL_NTC_BASE + (float)(table_len - 1u) * (float)CAL_NTC_STEP;
    }

    /* Find bracketing interval */
    for (uint8_t i = 0u; i < (table_len - 1u); i++) {
        if (adc <= CAL_NTC_ADC[i] && adc > CAL_NTC_ADC[i + 1u]) {
            float t_lo  = (float)CAL_NTC_BASE + (float)i       * (float)CAL_NTC_STEP;
            float t_hi  = (float)CAL_NTC_BASE + (float)(i + 1u) * (float)CAL_NTC_STEP;
            float adc_lo = (float)CAL_NTC_ADC[i];
            float adc_hi = (float)CAL_NTC_ADC[i + 1u];
            /* Linear interpolation within the 10 °C bracket */
            float frac  = (adc_lo - (float)adc) / (adc_lo - adc_hi);
            return t_lo + frac * (t_hi - t_lo);
        }
    }
    return 0.0f;   /* should not reach here */
}
