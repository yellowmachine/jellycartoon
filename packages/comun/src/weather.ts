/**
 * The weather for the voice (#223), at home and in Seilide: Open-Meteo (https://open-meteo.com),
 * free and without a key, its forecast and its search of places. Only the point asked about leaves,
 * when the weather is asked.
 */

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
/** The forecasts as they were, kept since 2022: the weather of days gone (a trip's report, #505). */
const PAST_URL = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
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
	/** The house's own point, from the phone's location there; else the town's centre. */
	exact?: boolean;
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

/** One day of the next ones, at a glance. */
export interface DayGlance {
	/** Its day, YYYY-MM-DD, where they live. */
	day: string;
	/** WMO's code, for its icon. */
	code: number;
	min: number;
	max: number;
	/** Its chance of rain, %. */
	rain: number;
}

/** How many days the home page shows, counting today. */
export const GLANCE_DAYS = 7;

/**
 * The weather at a glance (Seilide's home page): now, today's lowest, highest and rain, and the
 * next days, today first.
 */
export interface WeatherGlance {
	temperature: number;
	sky: string;
	/** WMO's code, for its icon. */
	code: number;
	min: number;
	max: number;
	/** Today's chance of rain, %. */
	rain: number;
	days: DayGlance[];
}

export async function weatherGlance(lat: number, lon: number): Promise<WeatherGlance> {
	const url = new URL(FORECAST_URL);
	url.searchParams.set('latitude', String(lat));
	url.searchParams.set('longitude', String(lon));
	url.searchParams.set('current', 'temperature_2m,weather_code');
	url.searchParams.set(
		'daily',
		'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
	);
	url.searchParams.set('timezone', TIME_ZONE);
	url.searchParams.set('forecast_days', String(GLANCE_DAYS));
	const data = await getJson(url);
	const d = data.daily;
	return {
		temperature: round(data.current.temperature_2m),
		sky: sky(data.current.weather_code),
		code: data.current.weather_code,
		min: round(data.daily.temperature_2m_min[0]),
		max: round(data.daily.temperature_2m_max[0]),
		rain: data.daily.precipitation_probability_max[0] ?? 0,
		days: (d.time as string[]).map((day, i) => ({
			day,
			code: d.weather_code[i],
			min: round(d.temperature_2m_min[i]),
			max: round(d.temperature_2m_max[i]),
			rain: d.precipitation_probability_max[i] ?? 0
		}))
	};
}

/** Outside where they live (Enchufes → Temperatura): now, today's lowest and highest, and hour by hour. */
export interface OutsideWeather {
	/** °C and relative humidity %, now, as Open-Meteo estimates them for that point. */
	temperature: number;
	humidity: number;
	min: number;
	max: number;
	/** The last `days` days' hours up to now: `YYYY-MM-DDTHH:MM` in Spain's time, °C (one decimal). */
	hours: { at: string; temperature: number }[];
}

/** Days back Open-Meteo's forecast API gives (`past_days`, at most 92): what the chart shows. */
export const OUTSIDE_DAYS = 30;

export async function outsideWeather(
	lat: number,
	lon: number,
	now = new Date()
): Promise<OutsideWeather> {
	const url = new URL(FORECAST_URL);
	url.searchParams.set('latitude', String(lat));
	url.searchParams.set('longitude', String(lon));
	url.searchParams.set('current', 'temperature_2m,relative_humidity_2m');
	url.searchParams.set('hourly', 'temperature_2m');
	url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min');
	url.searchParams.set('timezone', TIME_ZONE);
	url.searchParams.set('past_days', String(OUTSIDE_DAYS));
	url.searchParams.set('forecast_days', '1');
	const data = await getJson(url);
	// Today's hours still to come are a forecast: only up to this one.
	const until = new Intl.DateTimeFormat('sv-SE', {
		timeZone: TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	})
		.format(now)
		.replace(' ', 'T');
	const h = data.hourly;
	const hours: OutsideWeather['hours'] = [];
	for (let i = 0; i < (h?.time?.length ?? 0); i++) {
		if (h.time[i] > until || h.temperature_2m[i] === null) continue;
		hours.push({ at: h.time[i], temperature: Math.round(h.temperature_2m[i] * 10) / 10 });
	}
	const last = data.daily.time.length - 1;
	return {
		temperature: Math.round(data.current.temperature_2m * 10) / 10,
		humidity: round(data.current.relative_humidity_2m),
		min: round(data.daily.temperature_2m_min[last]),
		max: round(data.daily.temperature_2m_max[last]),
		hours
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

/** One of the next hours (the rules', #331): when, and what it will be like. */
export interface HourAhead {
	/** `YYYY-MM-DDTHH:MM`, in Spain's time. */
	at: string;
	temperature: number;
	/** Chance of rain, %. */
	rain: number;
	/** km/h. */
	wind: number;
	code: number;
}

/** At `lat`, `lon`, the next `hours` hours (this one first), hour by hour. */
export async function hoursAhead(lat: number, lon: number, hours: number): Promise<HourAhead[]> {
	const url = new URL(FORECAST_URL);
	url.searchParams.set('latitude', String(lat));
	url.searchParams.set('longitude', String(lon));
	url.searchParams.set(
		'hourly',
		'temperature_2m,precipitation_probability,weather_code,wind_speed_10m'
	);
	url.searchParams.set('timezone', TIME_ZONE);
	url.searchParams.set('forecast_hours', String(Math.max(1, Math.min(hours, 72))));
	const h = (await getJson(url)).hourly;
	return (h.time as string[]).map((at, i) => ({
		at,
		temperature: round(h.temperature_2m[i]),
		rain: h.precipitation_probability[i] ?? 0,
		wind: round(h.wind_speed_10m[i]),
		code: h.weather_code[i]
	}));
}

/** The sun on one hour of panels: `day` and the hour it starts (0–23), in Spain's time. */
export interface SunHour {
	day: string;
	hour: number;
	/** W/m² on the panels, that hour's mean. */
	wm2: number;
}

/**
 * The sun forecast on panels at `lat`, `lon` tilted `tilt` degrees (0 flat, 90 upright) and facing
 * `azimuth` (0 south, −90 east, 90 west, ±180 north), as Open-Meteo gives it
 * (`global_tilted_irradiance`), from `today` FORECAST_DAYS ahead. Each value of Open-Meteo is the
 * mean of the hour before its time: the one at 13:00 is 12:00 to 13:00, so here it is hour 12.
 */
export async function sunOnPanels(
	lat: number,
	lon: number,
	tilt: number,
	azimuth: number,
	today: string
): Promise<SunHour[]> {
	const url = new URL(FORECAST_URL);
	url.searchParams.set('latitude', String(lat));
	url.searchParams.set('longitude', String(lon));
	url.searchParams.set('hourly', 'global_tilted_irradiance');
	url.searchParams.set('tilt', String(tilt));
	url.searchParams.set('azimuth', String(azimuth));
	url.searchParams.set('timezone', TIME_ZONE);
	url.searchParams.set('start_date', today);
	url.searchParams.set('end_date', minusDays(today, -(FORECAST_DAYS - 1)));
	const h = (await getJson(url)).hourly;
	const out: SunHour[] = [];
	for (let i = 0; i < (h?.time?.length ?? 0); i++) {
		const wm2 = h.global_tilted_irradiance[i];
		if (wm2 === null || wm2 === undefined) continue;
		const at = h.time[i] as string;
		const end = Number(at.slice(11, 13));
		// The hour ending at midnight is the last of the day before.
		const day = end === 0 ? minusDays(at.slice(0, 10), 1) : at.slice(0, 10);
		if (day < today) continue;
		out.push({ day, hour: end === 0 ? 23 : end - 1, wm2: Math.max(0, wm2) });
	}
	return out;
}

/** Snow, by its WMO codes (as Open-Meteo gives them): snowfall, grains and showers. */
export const isSnow = (code: number) => (code >= 71 && code <= 77) || code === 85 || code === 86;

/** One day gone: its sky, lowest and highest, and rain (mm). */
export interface DayWeather {
	day: string;
	code: number;
	sky: string;
	min: number;
	max: number;
	rain: number;
}

/**
 * The weather it was at `lat`, `lon` from `from` to `to` (`YYYY-MM-DD`, both included), day by day:
 * Open-Meteo's forecasts as they were (its Historical Forecast API, from 2022).
 */
export async function pastWeather(
	lat: number,
	lon: number,
	from: string,
	to: string
): Promise<DayWeather[]> {
	const url = new URL(PAST_URL);
	url.searchParams.set('latitude', String(lat));
	url.searchParams.set('longitude', String(lon));
	url.searchParams.set(
		'daily',
		'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum'
	);
	url.searchParams.set('timezone', TIME_ZONE);
	url.searchParams.set('start_date', from);
	url.searchParams.set('end_date', to);
	const d = (await getJson(url)).daily;
	const days: DayWeather[] = [];
	for (let i = 0; i < (d?.time?.length ?? 0); i++) {
		if (d.weather_code[i] === null || d.temperature_2m_max[i] === null) continue;
		days.push({
			day: d.time[i],
			code: d.weather_code[i],
			sky: sky(d.weather_code[i]),
			min: round(d.temperature_2m_min[i]),
			max: round(d.temperature_2m_max[i]),
			rain: d.precipitation_sum[i] ?? 0
		});
	}
	return days;
}

/** A day's weather for reading (Preguntar's read_weather): its mean too, and whether forecast. */
export interface DayReading {
	day: string;
	sky: string;
	/** °C, one decimal. */
	min: number;
	max: number;
	mean: number;
	/** mm. */
	rain: number;
	forecast: boolean;
}

/** Days back the forecast API answers by dates (it keeps about three months). */
const RECENT_DAYS = 90;
const minusDays = (day: string, n: number) => {
	const d = new Date(`${day}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
};

/**
 * At `lat`, `lon`, from `from` to `to` (both included), day by day; with `everyHours`, also
 * those hours' temperature. The last three months and the next days from the forecast API (its
 * days from `today` on are forecasts); older, from its forecasts as they were (since 2022), and
 * then nothing from today on. `to` past FORECAST_DAYS is cut there.
 */
export async function readWeather(
	lat: number,
	lon: number,
	from: string,
	to: string,
	today: string,
	everyHours: number | null = null
): Promise<{ days: DayReading[]; hours: { at: string; temperature: number }[] }> {
	const recent = from >= minusDays(today, RECENT_DAYS);
	const last = recent
		? [to, minusDays(today, -(FORECAST_DAYS - 1))].sort()[0]!
		: [to, minusDays(today, 1)].sort()[0]!;
	if (last < from) return { days: [], hours: [] };
	const url = new URL(recent ? FORECAST_URL : PAST_URL);
	url.searchParams.set('latitude', String(lat));
	url.searchParams.set('longitude', String(lon));
	url.searchParams.set(
		'daily',
		'weather_code,temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum'
	);
	if (everyHours) url.searchParams.set('hourly', 'temperature_2m');
	url.searchParams.set('timezone', TIME_ZONE);
	url.searchParams.set('start_date', from);
	url.searchParams.set('end_date', last);
	const data = await getJson(url);
	const d = data.daily;
	// + 0: never «-0».
	const one = (n: number) => Math.round(n * 10) / 10 + 0;
	const days: DayReading[] = [];
	for (let i = 0; i < (d?.time?.length ?? 0); i++) {
		if (d.temperature_2m_max[i] === null || d.temperature_2m_min[i] === null) continue;
		const min = one(d.temperature_2m_min[i]);
		const max = one(d.temperature_2m_max[i]);
		days.push({
			day: d.time[i],
			sky: sky(d.weather_code[i]),
			min,
			max,
			mean: one(d.temperature_2m_mean?.[i] ?? (min + max) / 2),
			rain: one(d.precipitation_sum[i] ?? 0),
			forecast: d.time[i] >= today
		});
	}
	const h = data.hourly;
	const hours: { at: string; temperature: number }[] = [];
	if (everyHours)
		for (let i = 0; i < (h?.time?.length ?? 0); i += everyHours)
			if (h.temperature_2m[i] !== null)
				hours.push({ at: h.time[i], temperature: one(h.temperature_2m[i]) });
	return { days, hours };
}
