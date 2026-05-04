/**
 * @unit    SWU-CFG-001
 * @name    Motor Calibration & System Thresholds
 * @type    calibration
 * @asil    B
 * @sdd     SDD-CFG-001
 * @req     SWR-CFG-001, SWR-CFG-002, SWR-CFG-003
 * @author  A. Guerrero
 * @language c
 *
 * Calibration constants, lookup tables and system thresholds.
 * All values are ROM-resident (const) and must not be changed at runtime.
 * Updating any value here constitutes a calibration change and requires
 * a new review session before release (ASIL B re-verification scope).
 */

#include "motor_control.h"
#include "safety_monitor.h"
#include <stdint.h>

/* ── PID gains ───────────────────────────────────────────────────────────── */

const float CAL_PID_KP          = 1.2f;   /* proportional gain */
const float CAL_PID_KI          = 0.05f;  /* integral gain     */
const float CAL_PID_KD          = 0.01f;  /* derivative gain   */
const float CAL_PID_INTEGRAL_MAX = 500.0f; /* anti-windup clamp */

/* ── Speed limits ────────────────────────────────────────────────────────── */

const uint16_t CAL_MOTOR_MAX_RPM   = 8000u;
const uint16_t CAL_MOTOR_MIN_RPM   =   50u;  /* below this: considered stopped */
const uint16_t CAL_MOTOR_RAMP_STEP =  200u;  /* RPM/cycle soft-start ramp      */

/* ── Safety thresholds ───────────────────────────────────────────────────── */

const float    CAL_OVER_TEMP_C       =  85.0f;  /* °C — emergency stop threshold */
const float    CAL_WARN_TEMP_C       =  75.0f;  /* °C — log warning, reduce power */
const uint16_t CAL_UNDERVOLT_MV      = 10500u;  /* mV — 10.5 V minimum supply    */
const uint16_t CAL_OVERVOLT_MV       = 15000u;  /* mV — 15.0 V maximum supply    */

/* ── NTC thermistor lookup table (ADC count → °C, 12-bit ADC, 3.3 V ref) ── */
/* Sampled at 10 °C intervals from -10 °C to 120 °C */

const uint16_t CAL_NTC_ADC[14] = {
    3950, 3820, 3640, 3400, 3100,   /* -10, 0, 10, 20, 30 °C */
    2760, 2390, 2020, 1680, 1380,   /*  40, 50, 60, 70, 80 °C */
    1120,  900,  720,  580          /*  90, 100, 110, 120 °C  */
};
const int8_t CAL_NTC_TEMP_BASE   = -10;  /* °C at index 0 */
const int8_t CAL_NTC_TEMP_STEP   =  10;  /* °C per step   */

/* ── Encoder resolution ──────────────────────────────────────────────────── */

const uint16_t CAL_ENC_PPR       = 1024u;  /* pulses per revolution (quadrature → ×4) */
const uint16_t CAL_ENC_SAMPLE_HZ = 1000u;  /* encoder sampled at 1 kHz (motor task)   */
