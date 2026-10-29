import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import type { Place } from 'comun/weather.ts';

/**
 * Where the house is, for the voice's weather (#223, comun/weather.ts): chosen once in Ajustes →
 * Casa among what the search finds («Toledo» is first in Ohio).
 */

export { findPlaces, forecast, placeName, type Place } from 'comun/weather.ts';

export async function housePlace(): Promise<Place | null> {
	const value = await getAppSetting('house_place');
	if (!value) return null;
	try {
		return JSON.parse(value) as Place;
	} catch {
		return null;
	}
}

export async function setHousePlace(place: Place | null) {
	await setAppSetting('house_place', place ? JSON.stringify(place) : null);
}
