/**
 * @unit    SWU-CFG-001
 * @name    Motor Calibration & Thresholds
 * @type    calibration
 * @asil    B
 * @sdd     SDD-CFG-001
 * @req     SWR-CFG-001, SWR-CFG-002, SWR-CFG-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  in_review
 *
 * v2: OVER_TEMP 85->90, WARN_TEMP 75->80, UNDERVOLT 10500->10000 (ECR-2024-047).
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
const uint16_t CAL_RAMP_STEP   = 200u;

/* ── Thermal thresholds ──────────────────────────────────────────────────── */
const float    CAL_OVER_TEMP   = 90.0f;   /* ECR-2024-047: raised from 85 °C */
const float    CAL_WARN_TEMP   = 80.0f;   /* ECR-2024-047: raised from 75 °C */

/* ── Voltage rails ───────────────────────────────────────────────────────── */
const uint16_t CAL_UNDERVOLT_MV = 10000u; /* ECR-2024-047: lowered from 10500 mV */
const uint16_t CAL_OVERVOLT_MV  = 15000u;

/* ── Encoder resolution ──────────────────────────────────────────────────── */
const uint16_t CAL_ENC_PPR = 1024u;

/* ── NTC temperature lookup (ADC counts @ 12-bit / 3.3 V ref) ──────────── */
const uint16_t CAL_NTC_ADC[14] = {
    3950, 3820, 3640, 3400, 3100,
    2760, 2390, 2020, 1680, 1380,
    1120,  900,  720,  580
};

const int8_t CAL_NTC_BASE = -10;
const int8_t CAL_NTC_STEP =  10;

/* ── cal_ntc_to_celsius ───────────────────────────────────────────────────── */
float cal_ntc_to_celsius(uint16_t adc)
{
    const uint8_t table_len = (uint8_t)(sizeof(CAL_NTC_ADC) / sizeof(CAL_NTC_ADC[0]));

    if (adc >= CAL_NTC_ADC[0]) {
        return (float)CAL_NTC_BASE;
    }
    if (adc <= CAL_NTC_ADC[table_len - 1u]) {
        return (float)CAL_NTC_BASE + (float)(table_len - 1u) * (float)CAL_NTC_STEP;
    }

    for (uint8_t i = 0u; i < (table_len - 1u); i++) {
        if (adc <= CAL_NTC_ADC[i] && adc > CAL_NTC_ADC[i + 1u]) {
            float t_lo  = (float)CAL_NTC_BASE + (float)i        * (float)CAL_NTC_STEP;
            float t_hi  = (float)CAL_NTC_BASE + (float)(i + 1u) * (float)CAL_NTC_STEP;
            float adc_lo = (float)CAL_NTC_ADC[i];
            float adc_hi = (float)CAL_NTC_ADC[i + 1u];
            float frac  = (adc_lo - (float)adc) / (adc_lo - adc_hi);
            return t_lo + frac * (t_hi - t_lo);
        }
    }
    return 0.0f;
}
