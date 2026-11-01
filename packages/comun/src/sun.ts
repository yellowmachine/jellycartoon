import type { LngLat } from './road.ts';

/**
 * Where the sun is, for the road mode's light (day or night by itself). The usual low-precision
 * formulas (as in SunCalc, after https://aa.quae.nl/en/reken/zonpositie.html): a minute or two
 * off, plenty for this.
 */

const RAD = Math.PI / 180;
/** The Earth's tilt. */
const TILT = 23.4397 * RAD;
/** Its top edge on the horizon, with the air bending its light: sunrise and sunset. */
const HORIZON = -0.833;

/** The sun's height over the horizon, in degrees, at `at` and `date`. */
export function sunAltitude([lng, lat]: LngLat, date: Date) {
	// Days since noon on 2000-01-01 (J2000).
	const days = date.getTime() / 86_400_000 - 10_957.5;
	const anomaly = (357.5291 + 0.98560028 * days) * RAD;
	const centre =
		(1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly)) *
		RAD;
	const longitude = anomaly + centre + 102.9372 * RAD + Math.PI;
	const declination = Math.asin(Math.sin(longitude) * Math.sin(TILT));
	const ascension = Math.atan2(Math.sin(longitude) * Math.cos(TILT), Math.cos(longitude));
	const sidereal = (280.16 + 360.9856235 * days + lng) * RAD;
	const hourAngle = sidereal - ascension;
	const phi = lat * RAD;
	return (
		Math.asin(
			Math.sin(phi) * Math.sin(declination) +
				Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle)
		) / RAD
	);
}

/** From sunrise to sunset there: the sun above the horizon. */
export const isDaytime = (at: LngLat, date: Date) => sunAltitude(at, date) > HORIZON;
