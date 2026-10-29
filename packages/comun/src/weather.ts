/**
 * The weather for the voice (#223), at home and in Seilide: Open-Meteo (https://open-meteo.com),
 * free and without a key, its forecast and its search of places. Only the point asked about leaves,
 * when the weather is asked.
 */

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 10_000;
/** A week ahead, as the voice is asked «¿y el sábado?». */
const DAYS = 7;
/** Hour by hour only for today and tomorrow, every few hours: «¿llueve esta tarde?». */
const HOURLY_EVERY = 3;
const TIME_ZONE = 'Europe/Madrid';

export interface Place {
	name: string;
	/** The province or region, and the country: to tell one Toledo from another. */
	region: string | null;
	country: string | null;
	lat: number;
	lon: number;
}

export const placeName = (p: Place) => [p.name, p.region, p.country].filter(Boolean).join(', ');

async function getJson(url: URL) {
	const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((err) => {
		throw new Error(
			`No se pudo hablar con Open-Meteo: ${err instanceof Error ? err.message : err}`
		);
	});
	if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
	return res.json();
}

/** Places by their name, the most likely first. */
export async function findPlaces(name: string, count = 5): Promise<Place[]> {
	const url = new URL(GEOCODING_URL);
	url.searchParams.set('name', name);
	url.searchParams.set('count', String(count));
	url.searchParams.set('language', 'es');
	url.searchParams.set('format', 'json');
	const data = await getJson(url);
	return ((data.results ?? []) as Record<string, unknown>[]).map((r) => ({
		name: String(r.name),
		region: typeof r.admin1 === 'string' ? r.admin1 : null,
		country: typeof r.country === 'string' ? r.country : null,
		lat: Number(r.latitude),
		lon: Number(r.longitude)
	}));
}

/** WMO's weather codes, as Open-Meteo gives them, said in Spanish. */
const SKIES: Record<number, string> = {
	0: 'despejado',
	1: 'casi despejado',
	2: 'nubes y claros',
	3: 'nublado',
	45: 'niebla',
	48: 'niebla con escarcha',
	51: 'llovizna débil',
	53: 'llovizna',
	55: 'llovizna fuerte',
	56: 'llovizna helada',
	57: 'llovizna helada fuerte',
	61: 'lluvia débil',
	63: 'lluvia',
	65: 'lluvia fuerte',
	66: 'lluvia helada',
	67: 'lluvia helada fuerte',
	71: 'nieve débil',
	73: 'nieve',
	75: 'nieve fuerte',
	77: 'granizo fino',
	80: 'chubascos débiles',
	81: 'chubascos',
	82: 'chubascos fuertes',
	85: 'chubascos de nieve',
	86: 'chubascos de nieve fuertes',
	95: 'tormenta',
	96: 'tormenta con granizo',
	99: 'tormenta con granizo fuerte'
};
const sky = (code: number) => SKIES[code] ?? 'tiempo variable';
const round = (n: number) => Math.round(n);

/**
 * The forecast at `lat`, `lon`, as text for the AI: now, each of the next days, and today and
 * tomorrow every few hours.
 */
export async function forecast(lat: number, lon: number) {
	const url = new URL(FORECAST_URL);
	url.searchParams.set('latitude', String(lat));
	url.searchParams.set('longitude', String(lon));
	url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code');
	url.searchParams.set(
		'daily',
		'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max'
	);
	url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weather_code');
	url.searchParams.set('timezone', TIME_ZONE);
	url.searchParams.set('forecast_days', String(DAYS));
	const started = performance.now();
	const data = await getJson(url);
	console.info(`[tiempo] Previsión de Open-Meteo en ${Math.round(performance.now() - started)} ms`);

	const lines: string[] = [];
	const now = data.current;
	lines.push(
		`Ahora: ${round(now.temperature_2m)} °C (sensación ${round(now.apparent_temperature)} °C), ${sky(now.weather_code)}.`
	);
	const d = data.daily;
	for (let i = 0; i < d.time.length; i++) {
		const day = new Date(`${d.time[i]}T12:00:00`).toLocaleDateString('es-ES', {
			weekday: 'long',
			day: 'numeric',
			month: 'long'
		});
		const rain = d.precipitation_probability_max[i] ?? 0;
		lines.push(
			`${i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : day}${i < 2 ? ` (${day})` : ''}: ${sky(d.weather_code[i])}, de ${round(d.temperature_2m_min[i])} a ${round(d.temperature_2m_max[i])} °C, lluvia ${rain} %${d.precipitation_sum[i] ? ` (${d.precipitation_sum[i]} mm)` : ''}, viento hasta ${round(d.wind_speed_10m_max[i])} km/h.`
		);
	}
	const h = data.hourly;
	const today = d.time[0];
	const tomorrow = d.time[1];
	for (const [label, date] of [
		['Hoy', today],
		['Mañana', tomorrow]
	] as const) {
		const hours: string[] = [];
		for (let i = 0; i < h.time.length; i++) {
			const [day, time] = String(h.time[i]).split('T');
			const hour = Number(time!.slice(0, 2));
			if (day !== date || hour % HOURLY_EVERY) continue;
			hours.push(
				`${hour} h ${round(h.temperature_2m[i])} °C ${sky(h.weather_code[i])}${h.precipitation_probability[i] ? ` ${h.precipitation_probability[i]} %` : ''}`
			);
		}
		if (hours.length) lines.push(`${label} por horas: ${hours.join('; ')}.`);
	}
	return lines.join('\n');
}

/** The weather at a glance (Seilide's home page): now, and today's lowest, highest and rain. */
export interface WeatherGlance {
	temperature: number;
	sky: string;
	/** WMO's code, for its icon. */
	code: number;
	min: number;
	max: number;
	/** Today's chance of rain, %. */
	rain: number;
}

export async function weatherGlance(lat: number, lon: number): Promise<WeatherGlance> {
	const url = new URL(FORECAST_URL);
	url.searchParams.set('latitude', String(lat));
	url.searchParams.set('longitude', String(lon));
	url.searchParams.set('current', 'temperature_2m,weather_code');
	url.searchParams.set(
		'daily',
		'temperature_2m_max,temperature_2m_min,precipitation_probability_max'
	);
	url.searchParams.set('timezone', TIME_ZONE);
	url.searchParams.set('forecast_days', '1');
	const data = await getJson(url);
	return {
		temperature: round(data.current.temperature_2m),
		sky: sky(data.current.weather_code),
		code: data.current.weather_code,
		min: round(data.daily.temperature_2m_min[0]),
		max: round(data.daily.temperature_2m_max[0]),
		rain: data.daily.precipitation_probability_max[0] ?? 0
	};
}

/** An emoji for WMO's code: the sky at a glance. */
export function skyIcon(code: number) {
	if (code === 0 || code === 1) return '☀️';
	if (code === 2) return '⛅';
	if (code === 3) return '☁️';
	if (code === 45 || code === 48) return '🌫️';
	if (code >= 71 && code <= 77) return '🌨️';
	if (code === 85 || code === 86) return '🌨️';
	if (code >= 95) return '⛈️';
	return '🌧️';
}

/** How far ahead Open-Meteo forecasts, in days counting today. */
export const FORECAST_DAYS = 16;

/** The weather at one hour of one day (a trip's leg: where and when it leaves, where it arrives). */
export interface HourWeather {
	temperature: number;
	sky: string;
	code: number;
	/** Chance of rain, %. */
	rain: number;
	/** km/h. */
	wind: number;
}

/**
 * At `lat`, `lon`, on `day` (`YYYY-MM-DD`) at `hour` (0–23), in Spain's time; null if that day is
 * past or too far ahead (`FORECAST_DAYS`) to be forecast yet.
 */
export async function hourWeather(
	lat: number,
	lon: number,
	day: string,
	hour: number,
	today: string
): Promise<HourWeather | null> {
	const last = new Date(`${today}T12:00:00Z`);
	last.setUTCDate(last.getUTCDate() + FORECAST_DAYS - 1);
	if (day < today || day > last.toISOString().slice(0, 10)) return null;
	const url = new URL(FORECAST_URL);
	url.searchParams.set('latitude', String(lat));
	url.searchParams.set('longitude', String(lon));
	url.searchParams.set(
		'hourly',
		'temperature_2m,precipitation_probability,weather_code,wind_speed_10m'
	);
	url.searchParams.set('timezone', TIME_ZONE);
	url.searchParams.set('start_date', day);
	url.searchParams.set('end_date', day);
	const h = (await getJson(url)).hourly;
	const i = Math.min(Math.max(hour, 0), h.time.length - 1);
	return {
		temperature: round(h.temperature_2m[i]),
		sky: sky(h.weather_code[i]),
		code: h.weather_code[i],
		rain: h.precipitation_probability[i] ?? 0,
		wind: round(h.wind_speed_10m[i])
	};
}
