#include "speed_sensor.h"
#include <stdint.h>
#include <stdbool.h>

#define ENCODER_PPR  1024u
#define SAMPLE_MS      10u
#define ALPHA           0.8f

static uint32_t g_prev = 0;
static float    g_rpm  = 0.0f;

/**
 * @unit    SWU-SEN-001
 * @name    speed_sensor_init
 * @type    function
 * @asil    B
 * @sdd     SDD-SEN-001
 * @req     SWR-SEN-001
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Resets counters and initialises encoder hardware.
 */
void speed_sensor_init(void) { g_prev = 0; g_rpm = 0.0f; encoder_hw_init(); }

/**
 * @unit    SWU-SEN-002
 * @name    speed_sensor_read_rpm
 * @type    function
 * @asil    B
 * @sdd     SDD-SEN-001
 * @req     SWR-SEN-002
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Reads encoder delta, converts to RPM, applies low-pass filter.
 */
float speed_sensor_read_rpm(void)
{
    uint32_t cur   = encoder_get_count();
    uint32_t delta = cur - g_prev;
    g_prev = cur;
    float raw = ((float)delta / (float)ENCODER_PPR) * (60000.0f / (float)SAMPLE_MS);
    g_rpm = ALPHA * g_rpm + (1.0f - ALPHA) * raw;
    return g_rpm;
}

/**
 * @unit    SWU-SEN-003
 * @name    speed_sensor_reset
 * @type    function
 * @asil    QM
 * @sdd     SDD-SEN-001
 * @req     SWR-SEN-003
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Resets encoder count and filtered RPM to zero.
 */
void speed_sensor_reset(void) { encoder_reset_count(); g_prev = 0; g_rpm = 0.0f; }

/**
 * @unit    SWU-SEN-004
 * @name    speed_sensor_is_stalled
 * @type    function
 * @asil    B
 * @sdd     SDD-SEN-001
 * @req     SWR-SEN-004
 * @author  A. Guerrero
 * @date    2026-05-04
 * @status  approved
 * Returns true when filtered RPM is below the stall threshold.
 */
bool speed_sensor_is_stalled(float min_rpm) { return g_rpm < min_rpm; }