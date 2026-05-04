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

/* â”€â”€ PID gains â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const float CAL_PID_KP          = 1.2f;   /* proportional gain */
const float CAL_PID_KI          = 0.05f;  /* integral gain     */
const float CAL_PID_KD          = 0.01f;  /* derivative gain   */
const float CAL_PID_INTEGRAL_MAX = 500.0f; /* anti-windup clamp */

/* â”€â”€ Speed limits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const uint16_t CAL_MOTOR_MAX_RPM   = 8000u;
const uint16_t CAL_MOTOR_MIN_RPM   =   50u;  /* below this: considered stopped */
const uint16_t CAL_MOTOR_RAMP_STEP =  200u;  /* RPM/cycle soft-start ramp      */

/* â”€â”€ Safety thresholds â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const float    CAL_OVER_TEMP_C       =  85.0f;  /* Â°C â€” emergency stop threshold */
const float    CAL_WARN_TEMP_C       =  75.0f;  /* Â°C â€” log warning, reduce power */
const uint16_t CAL_UNDERVOLT_MV      = 10500u;  /* mV â€” 10.5 V minimum supply    */
const uint16_t CAL_OVERVOLT_MV       = 15000u;  /* mV â€” 15.0 V maximum supply    */

/* â”€â”€ NTC thermistor lookup table (ADC count â†’ Â°C, 12-bit ADC, 3.3 V ref) â”€â”€ */
/* Sampled at 10 Â°C intervals from -10 Â°C to 120 Â°C */

const uint16_t CAL_NTC_ADC[14] = {
    3950, 3820, 3640, 3400, 3100,   /* -10, 0, 10, 20, 30 Â°C */
    2760, 2390, 2020, 1680, 1380,   /*  40, 50, 60, 70, 80 Â°C */
    1120,  900,  720,  580          /*  90, 100, 110, 120 Â°C  */
};
const int8_t CAL_NTC_TEMP_BASE   = -10;  /* Â°C at index 0 */
const int8_t CAL_NTC_TEMP_STEP   =  10;  /* Â°C per step   */

/* â”€â”€ Encoder resolution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const uint16_t CAL_ENC_PPR       = 1024u;  /* pulses per revolution (quadrature â†’ Ã—4) */
const uint16_t CAL_ENC_SAMPLE_HZ = 1000u;  /* encoder sampled at 1 kHz (motor task)   */
