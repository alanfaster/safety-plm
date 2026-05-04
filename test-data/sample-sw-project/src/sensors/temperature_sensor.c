/**
 * @unit    SWU-SEN-002
 * @name    Temperature Sensor Driver
 * @type    function
 * @asil    A
 * @sdd     SDD-SEN-002
 * @req     SWR-SEN-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 *
 * Reads NTC thermistor via ADC and converts to Celsius.
 */

#include "temperature_sensor.h"
#include <stdint.h>
#include <math.h>

#define NTC_BETA        3950.0f     /* NTC beta coefficient (K) */
#define NTC_R25         10000.0f    /* resistance at 25 °C (Ω) */
#define NTC_R_SERIES    10000.0f    /* series resistor in voltage divider (Ω) */
#define ADC_RES         4096u       /* 12-bit ADC full-scale count */
#define VREF            3.3f        /* ADC reference voltage (V) */
#define T25_K           298.15f     /* 25 °C in Kelvin */
#define ADC_CHANNEL_TEMP 4u         /* ADC channel connected to NTC */

extern uint16_t adc_read_channel(uint8_t ch);

/* ── temperature_read_raw ────────────────────────────────────────────────── */
uint16_t temperature_read_raw(void)
{
    return adc_read_channel(ADC_CHANNEL_TEMP);
}

/* ── temperature_get_ntc_resistance ──────────────────────────────────────── */
float temperature_get_ntc_resistance(void)
{
    uint16_t raw    = temperature_read_raw();
    /* Voltage divider: V_adc = Vref * R_ntc / (R_series + R_ntc)
     * Rearranged: R_ntc = R_series * raw / (ADC_RES - raw)              */
    if (raw >= (uint16_t)(ADC_RES - 1u)) return 0.0f;   /* short-circuit guard */
    float r_ntc = NTC_R_SERIES * (float)raw / ((float)ADC_RES - (float)raw);
    return r_ntc;
}

/* ── temperature_read_celsius ─────────────────────────────────────────────── */
float temperature_read_celsius(void)
{
    float r_ntc = temperature_get_ntc_resistance();
    if (r_ntc <= 0.0f) return 200.0f;   /* report high temperature on fault */

    /* Steinhart-Hart simplified (beta) equation:
     * 1/T = 1/T25 + (1/beta) * ln(R/R25)                                */
    float inv_t = (1.0f / T25_K) + (1.0f / NTC_BETA) * logf(r_ntc / NTC_R25);
    float temp_k = 1.0f / inv_t;
    return temp_k - 273.15f;   /* convert Kelvin to Celsius */
}

/* ── temperature_is_critical ─────────────────────────────────────────────── */
bool temperature_is_critical(float limit)
{
    return temperature_read_celsius() >= limit;
}
