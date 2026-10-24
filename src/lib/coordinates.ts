import type { LngLat } from './road.ts';

/**
 * A point pasted from somewhere else (#151): coordinates as Google Maps gives them («40.4168,
 * -3.7038», latitude first), in degrees, minutes and seconds («40°25'00.5"N 3°42'13.7"W»), or a
 * link to a map (Google Maps, OpenStreetMap, `geo:`). As ours, [longitude, latitude]; null if it is
 * none of those.
 */
export function parseCoordinates(text: string): LngLat | null {
	const t = text.trim();
	if (!t) return null;
	return fromLink(t) ?? fromDms(t) ?? fromDecimal(t);
}

const valid = (lat: number, lon: number): LngLat | null =>
	Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
		? [lon, lat]
		: null;

const NUMBER = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

/** «40.4168, -3.7038», «40.4168 -3.7038», «40,4168; -3,7038» (decimal comma, as in Spain). */
function fromDecimal(t: string): LngLat | null {
	const dot = t.match(new RegExp(String.raw`^(${NUMBER})\s*[,;\s]\s*(${NUMBER})$`));
	if (dot) return valid(Number(dot[1]), Number(dot[2]));
	const comma = t.match(/^([-+]?\d{1,3},\d+)\s*[;\s]\s*([-+]?\d{1,3},\d+)$/);
	if (comma) return valid(Number(comma[1]!.replace(',', '.')), Number(comma[2]!.replace(',', '.')));
	return null;
}

/** «40°25'00.5"N 3°42'13.7"W», «N 40° 25.008' W 3° 42.228'», with or without minutes or seconds. */
function fromDms(t: string): LngLat | null {
	// The letters before each number («N 40°…») or after it («40°…N»), not both: in «N 40° 25' W 3°»
	// the W is the second one's.
	const before = /^[NSEWO]/i.test(t);
	const number = String.raw`(\d{1,3}(?:[.,]\d+)?)\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|″|''|′′)\s*)?`;
	const part = before ? String.raw`([NSEWO])\s*${number}()` : String.raw`()${number}([NSEWO])?`;
	const found = [...t.matchAll(new RegExp(part, 'gi'))].filter((m) => m[2]);
	if (found.length !== 2) return null;
	let lat: number | null = null;
	let lon: number | null = null;
	for (const [i, m] of found.entries()) {
		const num = (s: string | undefined) => Number((s ?? '0').replace(',', '.'));
		let value = num(m[2]) + num(m[3]) / 60 + num(m[4]) / 3600;
		const hemisphere = (m[1] || m[5])?.toUpperCase();
		if (hemisphere === 'S' || hemisphere === 'W' || hemisphere === 'O') value = -value;
		// Without a letter: latitude first, as written everywhere.
		const isLon = hemisphere ? 'EWO'.includes(hemisphere) : i === 1;
		if (isLon) lon = value;
		else lat = value;
	}
	return lat === null || lon === null ? null : valid(lat, lon);
}

/** The point a map link is about: its pin first, then where the map is looking. */
function fromLink(t: string): LngLat | null {
	if (/^geo:/i.test(t)) {
		const m = t.match(new RegExp(String.raw`^geo:(${NUMBER}),(${NUMBER})`, 'i'));
		return m ? valid(Number(m[1]), Number(m[2])) : null;
	}
	let url: URL;
	try {
		url = new URL(t);
	} catch {
		return null;
	}
	const pair = (value: string | null) => (value ? fromDecimal(decodeURIComponent(value)) : null);
	// Google's pin: «!3d40.4168!4d-3.7038» in the path.
	const pin = t.match(new RegExp(String.raw`!3d(${NUMBER})!4d(${NUMBER})`));
	if (pin) return valid(Number(pin[1]), Number(pin[2]));
	// OpenStreetMap's marker.
	const mlat = url.searchParams.get('mlat');
	const mlon = url.searchParams.get('mlon');
	if (mlat && mlon) return valid(Number(mlat), Number(mlon));
	// «?q=40.4168,-3.7038», «?query=…», «?ll=…», «?destination=…».
	for (const key of ['q', 'query', 'll', 'destination', 'daddr']) {
		const point = pair(url.searchParams.get(key));
		if (point) return point;
	}
	// «/maps/place/40.4168,-3.7038», «/maps/search/40.4168,+-3.7038».
	for (const piece of url.pathname.split('/')) {
		const point = pair(piece.replace(/\+/g, ' '));
		if (point) return point;
	}
	// Where the map is: Google's «@40.4168,-3.7038,15z», OpenStreetMap's «#map=15/40.4168/-3.7038».
	const at = t.match(new RegExp(String.raw`@(${NUMBER}),(${NUMBER})`));
	if (at) return valid(Number(at[1]), Number(at[2]));
	const osm = url.hash.match(new RegExp(String.raw`map=\d+(?:\.\d+)?/(${NUMBER})/(${NUMBER})`));
	if (osm) return valid(Number(osm[1]), Number(osm[2]));
	return null;
}
