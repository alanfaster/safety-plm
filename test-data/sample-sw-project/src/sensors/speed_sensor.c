/**
 * @unit    SWU-SEN-001
 * @name    Speed Sensor Driver
 * @type    function
 * @asil    B
 * @sdd     SDD-SEN-001
 * @req     SWR-SEN-001, SWR-SEN-002
 * @author  A. Guerrero
 * @language c
 *
 * Reads quadrature encoder pulses and computes RPM.
 */

#include "speed_sensor.h"
#include <stdint.h>

#define ENCODER_PPR         1024   /* pulses per revolution */
#define SAMPLE_PERIOD_MS    10     /* sampling period in ms */
#define RPM_FILTER_ALPHA    0.8f   /* low-pass filter coefficient */

static uint32_t g_prev_count  = 0;
static float    g_filtered_rpm = 0.0f;

/**
 * speed_sensor_init - Initialise encoder peripheral.
 */
void speed_sensor_init(void) {
    g_prev_count   = 0;
    g_filtered_rpm = 0.0f;
    encoder_hw_init();
}

/**
 * speed_sensor_read_rpm - Read current speed in RPM.
 * Uses a first-order low-pass filter to reduce noise.
 */
float speed_sensor_read_rpm(void) {
    uint32_t current_count = encoder_get_count();
    uint32_t delta         = current_count - g_prev_count;
    g_prev_count           = current_count;

    /* Convert pulse delta to RPM:
     *   RPM = (delta / PPR) * (60000 / SAMPLE_PERIOD_MS) */
    float raw_rpm = ((float)delta / ENCODER_PPR)
                  * (60000.0f / SAMPLE_PERIOD_MS);

    /* Apply low-pass filter */
    g_filtered_rpm = RPM_FILTER_ALPHA * g_filtered_rpm
                   + (1.0f - RPM_FILTER_ALPHA) * raw_rpm;

    return g_filtered_rpm;
}

/**
 * speed_sensor_reset - Reset encoder count and filter state.
 */
void speed_sensor_reset(void) {
    encoder_reset_count();
    g_prev_count   = 0;
    g_filtered_rpm = 0.0f;
}
