#include "motor_control.h"
#include "safety_monitor.h"
#include <stdint.h>

/**
 * @unit    SWU-CAL-001
 * @name    PID Gains
 * @type    calibration
 * @asil    B
 * @sdd     SDD-CFG-001
 * @req     SWR-CFG-001
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Proportional, integral and derivative gains for the motor PID controller.
 */
const float CAL_PID_KP = 1.2f;
const float CAL_PID_KI = 0.05f;
const float CAL_PID_KD = 0.01f;
const float CAL_PID_INTEGRAL_MAX = 500.0f;

/**
 * @unit    SWU-CAL-002
 * @name    Speed Limits
 * @type    calibration
 * @asil    B
 * @sdd     SDD-CFG-001
 * @req     SWR-CFG-002
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Motor speed operating range and soft-start ramp step.
 */
const uint16_t CAL_MAX_RPM   = 8000u;
const uint16_t CAL_MIN_RPM   =   50u;
const uint16_t CAL_RAMP_STEP =  200u;

/**
 * @unit    SWU-CAL-003
 * @name    Safety Thresholds
 * @type    calibration
 * @asil    B
 * @sdd     SDD-CFG-002
 * @req     SWR-CFG-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Temperature and voltage thresholds for the safety monitor.
 */
const float    CAL_OVER_TEMP_C  =  85.0f;
const float    CAL_WARN_TEMP_C  =  75.0f;
const uint16_t CAL_UNDERVOLT_MV = 10500u;
const uint16_t CAL_OVERVOLT_MV  = 15000u;

/**
 * @unit    SWU-CAL-004
 * @name    NTC Lookup Table
 * @type    calibration
 * @asil    A
 * @sdd     SDD-CFG-003
 * @req     SWR-CFG-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * ADC-to-temperature lookup for NTC thermistor, sampled every 10 C from -10 to 120.
 */
const uint16_t CAL_NTC_ADC[14] = {
    3950,3820,3640,3400,3100,
    2760,2390,2020,1680,1380,
    1120, 900, 720, 580
};
const int8_t CAL_NTC_BASE = -10;
const int8_t CAL_NTC_STEP =  10;

/**
 * @unit    SWU-CAL-005
 * @name    cal_ntc_to_celsius
 * @type    function
 * @asil    A
 * @sdd     SDD-CFG-003
 * @req     SWR-CFG-005
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Linear interpolation of NTC lookup table to convert ADC count to Celsius.
 */
float cal_ntc_to_celsius(uint16_t adc)
{
    for (int i = 0; i < 13; i++) {
        if (adc <= CAL_NTC_ADC[i] && adc >= CAL_NTC_ADC[i+1]) {
            float t = (float)(CAL_NTC_BASE + i * CAL_NTC_STEP);
            float frac = (float)(CAL_NTC_ADC[i] - adc) / (float)(CAL_NTC_ADC[i] - CAL_NTC_ADC[i+1]);
            return t + frac * (float)CAL_NTC_STEP;
        }
    }
    return (float)CAL_NTC_BASE;
}