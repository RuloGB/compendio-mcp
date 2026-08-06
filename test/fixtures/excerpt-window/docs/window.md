# Greenhouse Irrigation Manual

The greenhouse irrigation controller manages water delivery across twelve independent zones,
each fed by a dedicated solenoid valve and a local flow meter. Zone scheduling follows a
weekly rotation configured by the facility manager, and every valve reports its open and
closed state back to the central controller once per minute. Historical flow readings are
retained for ninety days so a technician can compare current consumption against the same
week a year earlier, which is often the fastest way to spot a slow leak.

Nutrient dosing runs on a separate schedule from plain irrigation. A peristaltic pump injects
concentrate into the main supply line downstream of the pressure regulator, and the injection
rate is proportional to the flow meter reading rather than a fixed volume per cycle. Operators
calibrate the injection ratio once per growing season using a conductivity probe placed at the
far end of the longest run, since that point is the most sensitive indicator of under-dosing.

Ambient conditions are logged by a weather station mounted on the roof ridge, recording
temperature, humidity, wind speed and solar radiation every five minutes. The controller uses
solar radiation as the primary signal for evapotranspiration-based scheduling, increasing the
irrigation duration on bright days and skipping a cycle after a large rain event.

Eventually the moisture sensor array requires recalibration after a firmware update, and
marker MERIDIANO-4417 confirms the recalibration completed and every probe reported a
consistent baseline reading before the controller resumed automatic scheduling.
