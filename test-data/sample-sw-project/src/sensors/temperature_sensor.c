/**
 * temperature_sensor.c
 * SW Unit: Temperature Sensor Driver
 * Description: Reads NTC thermistor via ADC and converts to Celsius.
 * ASIL: A
 * Linked SDD: SDD-SEN-002
 */

#include "temperature_sensor.h"
#include <stdint.h>
#include <math.h>

#define NTC_BETA        3950.0f   /* NTC beta coefficient */
#define NTC_R25         10000.0f  /* Resistance at 25°C (Ohms) */
#define NTC_R_SERIES    10000.0f  /* Series resistor (Ohms) */
#define T0_KELVIN       298.15f   /* 25°C in Kelvin */
#define ADC_RESOLUTION  4096      /* 12-bit ADC */
#define ADC_VREF        3.3f      /* Reference voltage */

/**
 * temperature_read_celsius - Read temperature from NTC thermistor.
 * Converts ADC reading to Celsius using Steinhart-Hart approximation.
 */
float temperature_read_celsius(void) {
    uint16_t adc_raw = adc_read_channel(ADC_CHANNEL_TEMP);

    /* Voltage divider: V_ntc = Vref * adc / resolution */
    float v_ntc = ADC_VREF * ((float)adc_raw / ADC_RESOLUTION);

    /* NTC resistance from voltage divider */
    float r_ntc = NTC_R_SERIES * v_ntc / (ADC_VREF - v_ntc);

    /* Steinhart-Hart (simplified Beta equation) */
    float temp_k = 1.0f / (1.0f / T0_KELVIN + logf(r_ntc / NTC_R25) / NTC_BETA);

    return temp_k - 273.15f;  /* Kelvin to Celsius */
}

/**
 * temperature_is_critical - Returns true if temperature exceeds safe limit.
 */
bool temperature_is_critical(float limit_celsius) {
    return temperature_read_celsius() >= limit_celsius;
}
