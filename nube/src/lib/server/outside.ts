import { outsideWeather, placeName, type OutsideWeather } from 'comun/weather.ts';
import { familyPlace } from './family-settings.ts';
import type { Kitchen } from './fridge.ts';

/**
 * The temperature outside where the family lives (Enchufes → Temperatura): Open-Meteo's estimate
 * for «Dónde vivís», not a thermometer. Nothing kept: its last days come with each ask, kept a
 * while for each place.
 */

const OUTSIDE_MS = 30 * 60_000;
const kept = new Map<string, { at: number; weather: Promise<OutsideWeather | null> }>();

function outsideAt(lat: number, lon: number) {
	const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
	const found = kept.get(key);
	if (found && Date.now() - found.at < OUTSIDE_MS) return found.weather;
	const weather = outsideWeather(lat, lon).catch((error) => {
		console.warn('[temperatura] Sin la de fuera', String(error));
		kept.delete(key);
		return null;
	});
	kept.set(key, { at: Date.now(), weather });
	return weather;
}

/** Where they live and its weather; `place` null without «Dónde vivís», `weather` null if it failed. */
export async function outsideOf(k: Kitchen) {
	const place = await familyPlace(k);
	if (!place) return { place: null, weather: null };
	return {
		place: place.name || placeName(place),
		weather: await outsideAt(place.lat, place.lon)
	};
}
