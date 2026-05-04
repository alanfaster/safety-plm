#include "temperature_sensor.h"
#include <stdint.h>
#include <math.h>
#include <stdbool.h>

#define NTC_BETA   3950.0f
#define NTC_R25    10000.0f
#define NTC_RSERIES 10000.0f
#define T0_K        298.15f
#define ADC_RES     4096
#define VREF        3.3f

/**
 * @unit    SWU-TEMP-001
 * @name    temperature_read_raw
 * @type    function
 * @asil    A
 * @sdd     SDD-SEN-002
 * @req     SWR-TEMP-001
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Returns raw 12-bit ADC value from the NTC thermistor channel.
 */
uint16_t temperature_read_raw(void) { return adc_read_channel(ADC_CHANNEL_TEMP); }

/**
 * @unit    SWU-TEMP-002
 * @name    temperature_get_ntc_resistance
 * @type    function
 * @asil    A
 * @sdd     SDD-SEN-002
 * @req     SWR-TEMP-002
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Computes NTC resistance from ADC reading via voltage-divider equation.
 */
float temperature_get_ntc_resistance(void)
{
    float v = VREF * ((float)temperature_read_raw() / (float)ADC_RES);
    if (v <= 0.0f || v >= VREF) return NTC_R25;
    return NTC_RSERIES * v / (VREF - v);
}

/**
 * @unit    SWU-TEMP-003
 * @name    temperature_read_celsius
 * @type    function
 * @asil    A
 * @sdd     SDD-SEN-002
 * @req     SWR-TEMP-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Converts NTC resistance to Celsius using Steinhart-Hart beta equation.
 */
float temperature_read_celsius(void)
{
    float r    = temperature_get_ntc_resistance();
    float tk   = 1.0f / (1.0f / T0_K + logf(r / NTC_R25) / NTC_BETA);
    return tk - 273.15f;
}

/**
 * @unit    SWU-TEMP-004
 * @name    temperature_is_critical
 * @type    function
 * @asil    A
 * @sdd     SDD-SEN-002
 * @req     SWR-TEMP-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Returns true when measured temperature meets or exceeds the given limit.
 */
bool temperature_is_critical(float limit_celsius)
{
    return temperature_read_celsius() >= limit_celsius;
}