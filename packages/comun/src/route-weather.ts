import type { LngLat } from './road.ts';

/**
 * The weather along a trip's way (Viajes → Próximos, phase 4): a point every so many minutes of
 * driving, each with the forecast of the hour it is passed, and only what matters to whoever
 * drives: snow, ice, fog, heavy rain, storms and strong wind. Open-Meteo, all the points at once.
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIME_ZONE = 'Europe/Madrid';
/**
 * A point every half hour of driving or every 15 km, whichever gives more: by time alone, a pass
 * between two points was missed (a 61 km leg, points at km 41 and 61, the pass at 48).
 */
const EVERY_SECONDS = 30 * 60;
const EVERY_METRES = 15_000;

export interface WayPoint {
	at: LngLat;
	/** When it is passed (ms). */
	when: number;
	/** Kilometres from the start. */
	km: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
/** Metres between two points, on the sphere. */
function metres(a: LngLat, b: LngLat) {
	const h =
		Math.sin(rad(b[1] - a[1]) / 2) ** 2 +
		Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
	return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * Points along `line`, one every `every` seconds of its `duration` or every `everyMetres`, at an
 * even speed (what the route says, all of it): the start, those between, and the end.
 */
export function wayPoints(
	line: LngLat[],
	departAt: number,
	duration: number,
	every = EVERY_SECONDS,
	everyMetres = EVERY_METRES
) {
	if (line.length < 2 || duration <= 0) return [];
	const lengths = [0];
	for (let i = 1; i < line.length; i++)
		lengths.push(lengths[i - 1]! + metres(line[i - 1]!, line[i]!));
	const total = lengths.at(-1)!;
	const steps = Math.max(1, Math.ceil(duration / every), Math.ceil(total / everyMetres));
	const points: WayPoint[] = [];
	let i = 1;
	for (let s = 0; s <= steps; s++) {
		const share = s / steps;
		const target = share * total;
		while (i < line.length - 1 && lengths[i]! < target) i++;
		const from = line[i - 1]!;
		const to = line[i]!;
		const span = lengths[i]! - lengths[i - 1]!;
		const t = span > 0 ? (target - lengths[i - 1]!) / span : 0;
		points.push({
			at: [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t],
			when: departAt + share * duration * 1000,
			km: Math.round(target / 1000)
		});
	}
	return points;
}

/** The forecast of one point at its hour, as Open-Meteo gives it. */
export interface PointWeather {
	temperature: number;
	/** mm in that hour, and cm of snow. */
	precipitation: number;
	snowfall: number;
	/** %. */
	rain: number;
	code: number;
	/** km/h. */
	gusts: number;
	/** Metres. */
	visibility: number;
	/** Of the point, metres above the sea. */
	elevation: number;
}

export type Hazard = 'nieve' | 'hielo' | 'niebla' | 'lluvia' | 'tormenta' | 'viento';

/** What to warn of, the worst first; none, a good road. */
export function hazardsOf(w: PointWeather): Hazard[] {
	const found: Hazard[] = [];
	const frozen = [56, 57, 66, 67].includes(w.code);
	if (w.snowfall > 0 || (w.code >= 71 && w.code <= 77) || w.code === 85 || w.code === 86)
		found.push('nieve');
	if (frozen || (w.temperature <= 1 && w.precipitation > 0 && !found.includes('nieve')))
		found.push('hielo');
	if (w.code >= 95) found.push('tormenta');
	if (w.code === 45 || w.code === 48 || w.visibility < 1000) found.push('niebla');
	if (!found.includes('tormenta') && (w.precipitation >= 4 || w.code === 65 || w.code === 82))
		found.push('lluvia');
	if (w.gusts >= 70) found.push('viento');
	return found;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Its hour as Open-Meteo writes it, in Spain's time (the server's TZ): `2026-10-31T13:00`. */
function hourKey(ms: number) {
	const d = new Date(ms);
	// The nearer hour: passing at 12:40, 13:00's forecast.
	d.setMinutes(d.getMinutes() + 30, 0, 0);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}
const dayOf = (ms: number) => hourKey(ms).slice(0, 10);

/** Each point's forecast at the hour it is passed; null for one Open-Meteo has no hour for. */
export async function wayWeather(points: WayPoint[]): Promise<(PointWeather | null)[]> {
	if (!points.length) return [];
	const url = new URL(FORECAST_URL);
	url.searchParams.set('latitude', points.map((p) => p.at[1].toFixed(4)).join(','));
	url.searchParams.set('longitude', points.map((p) => p.at[0].toFixed(4)).join(','));
	url.searchParams.set(
		'hourly',
		'temperature_2m,precipitation,snowfall,precipitation_probability,weather_code,wind_gusts_10m,visibility'
	);
	url.searchParams.set('timezone', TIME_ZONE);
	url.searchParams.set('start_date', dayOf(points[0]!.when));
	url.searchParams.set('end_date', dayOf(points.at(-1)!.when));
	const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
	if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
	const body = await res.json();
	const all = (Array.isArray(body) ? body : [body]) as {
		elevation: number;
		hourly: Record<string, (number | null)[]> & { time: string[] };
	}[];
	return points.map((p, i) => {
		const h = all[i]?.hourly;
		const at = h?.time.indexOf(hourKey(p.when)) ?? -1;
		if (!h || at < 0) return null;
		return {
			temperature: Math.round(h.temperature_2m![at] ?? 0),
			precipitation: h.precipitation![at] ?? 0,
			snowfall: h.snowfall![at] ?? 0,
			rain: h.precipitation_probability![at] ?? 0,
			code: h.weather_code![at] ?? 0,
			gusts: Math.round(h.wind_gusts_10m![at] ?? 0),
			visibility: h.visibility![at] ?? 100_000,
			elevation: Math.round(all[i]!.elevation)
		};
	});
}

/** A warning on the way: what, from when to when, where it starts, how high. */
export interface WayWarning {
	hazard: Hazard;
	/** ms: the first and last point with it. */
	from: number;
	to: number;
	at: LngLat;
	km: number;
	elevation: number;
	/** The worst of it: % of rain, cm of snow, km/h of gusts, metres of visibility. */
	rain: number;
	snowfall: number;
	gusts: number;
	visibility: number;
	temperature: number;
}

/** Each hazard in a row of points, once: «nieve de 12:40 a 13:40, desde el km 310». */
export function warningsOf(points: WayPoint[], weather: (PointWeather | null)[]): WayWarning[] {
	const warnings: WayWarning[] = [];
	const open = new Map<Hazard, WayWarning>();
	points.forEach((p, i) => {
		const w = weather[i];
		const now = new Set(w ? hazardsOf(w) : []);
		for (const [hazard, warning] of open)
			if (!now.has(hazard)) {
				warnings.push(warning);
				open.delete(hazard);
			}
		if (!w) return;
		for (const hazard of now) {
			const going = open.get(hazard);
			if (going) {
				going.to = p.when;
				going.rain = Math.max(going.rain, w.rain);
				going.snowfall = Math.max(going.snowfall, w.snowfall);
				going.gusts = Math.max(going.gusts, w.gusts);
				going.visibility = Math.min(going.visibility, w.visibility);
				going.temperature = Math.min(going.temperature, w.temperature);
				going.elevation = Math.max(going.elevation, w.elevation);
			} else
				open.set(hazard, {
					hazard,
					from: p.when,
					to: p.when,
					at: p.at,
					km: p.km,
					elevation: w.elevation,
					rain: w.rain,
					snowfall: w.snowfall,
					gusts: w.gusts,
					visibility: w.visibility,
					temperature: w.temperature
				});
		}
	});
	warnings.push(...open.values());
	return warnings.sort((a, b) => a.from - b.from);
}
