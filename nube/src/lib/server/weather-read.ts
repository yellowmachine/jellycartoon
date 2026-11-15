import { localDay } from 'comun/agenda.ts';
import { placeName, readWeather, type DayReading, type Place } from 'comun/weather.ts';
import { familyPlace } from './family-settings.ts';
import type { Kitchen } from './fridge.ts';
import { findPlacesFor } from './places.ts';

/**
 * Preguntar's «read_weather»: the weather of some days at home (or somewhere named), from
 * Open-Meteo, with each day's degree-days, to cross with what the plugs used, the bills or the
 * walks. Degree-days as Eurostat counts them
 * (https://ec.europa.eu/eurostat/cache/metadata/en/nrg_chdd_esms.htm): heating, 18 °C less the
 * day's mean when it is 15 °C or less; cooling, the mean less 21 °C when it is 24 °C or more.
 */

/** Days at once, at most: what the forecast API keeps by dates. */
export const WEATHER_DAYS = 92;
/** Up to this many days, also every few hours. */
const HOURLY_UP_TO = 3;
const EVERY_HOURS = 3;

export const heatingDegrees = (mean: number) => (mean <= 15 ? 18 - mean : 0);
export const coolingDegrees = (mean: number) => (mean >= 24 ? mean - 21 : 0);

const isDay = (v: unknown): v is string =>
	typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const daysBetween = (from: string, to: string) =>
	Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const n1 = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });

function dayLine(d: DayReading) {
	const heat = heatingDegrees(d.mean);
	const cool = coolingDegrees(d.mean);
	return [
		`${d.day}${d.forecast ? ' (previsión)' : ''}: ${n1(d.min)} a ${n1(d.max)} °C (media ${n1(d.mean)}), ${d.sky}, ${n1(d.rain)} mm`,
		heat ? `${n1(heat)} grados-día de calefacción` : '',
		cool ? `${n1(cool)} de refrigeración` : ''
	]
		.filter(Boolean)
		.join(', ');
}

/** The weather of those days, said in lines for the AI; or why not. */
export async function describeWeather(k: Kitchen, args: Record<string, unknown>) {
	const from = args.from_day;
	const to = args.to_day ?? from;
	if (!isDay(from) || !isDay(to)) return 'Faltan los días, AAAA-MM-DD.';
	const [first, last] = from <= to ? [from, to] : [to, from];
	if (daysBetween(first, last) > WEATHER_DAYS)
		return `Como mucho ${WEATHER_DAYS} días de una vez: pide el periodo por partes.`;
	if (first < '2022-01-01') return 'Open-Meteo guarda el tiempo desde 2022.';

	const asked = typeof args.place === 'string' ? args.place.trim().slice(0, 100) : '';
	let place: Place | null;
	if (asked) {
		place = (await findPlacesFor(k, asked, 1).catch(() => []))[0] ?? null;
		if (!place) return `No encuentro ningún sitio llamado «${asked}».`;
	} else {
		place = await familyPlace(k);
		if (!place)
			return 'La familia no ha dicho dónde vive (Ajustes → Familia → Dónde vivís): pregunta de qué sitio quiere el tiempo.';
	}

	const today = localDay();
	const hourly = daysBetween(first, last) <= HOURLY_UP_TO ? EVERY_HOURS : null;
	const read = await readWeather(place.lat, place.lon, first, last, today, hourly).catch(
		(error) => {
			console.warn('[preguntar] Sin el tiempo', String(error));
			return null;
		}
	);
	if (!read) return 'No se pudo hablar con Open-Meteo; prueba más tarde.';
	if (!read.days.length)
		return first >= today
			? 'Esos días están demasiado lejos para tener previsión (como mucho, 16 días).'
			: 'Open-Meteo no tiene el tiempo de esos días.';

	const where = asked
		? placeName(place)
		: `${placeName(place)}${place.exact ? ', el punto exacto de casa' : ''}`;
	const past = read.days.filter((d) => !d.forecast);
	const sum = (f: (d: DayReading) => number) => past.reduce((s, d) => s + f(d), 0);
	const lines = [
		`El tiempo en ${where}, del ${read.days[0]!.day} al ${read.days.at(-1)!.day}: la estimación de Open-Meteo para ese punto, no un termómetro.`,
		...read.days.map(dayLine)
	];
	if (read.hours.length)
		lines.push(
			`Cada ${EVERY_HOURS} horas: ${read.hours.map((h) => `${h.at.replace('T', ' ')} ${n1(h.temperature)} °C`).join('; ')}.`
		);
	if (past.length > 1)
		lines.push(
			`Los ${past.length} días ya pasados: media ${n1(sum((d) => d.mean) / past.length)} °C, ${n1(sum((d) => d.rain))} mm de lluvia, ${n1(sum((d) => heatingDegrees(d.mean)))} grados-día de calefacción y ${n1(sum((d) => coolingDegrees(d.mean)))} de refrigeración.`
		);
	lines.push(
		'Grados-día, como los cuenta Eurostat: de calefacción, 18 °C menos la media del día si es de 15 °C o menos; de refrigeración, la media menos 21 °C si es de 24 °C o más. Cuantos más, más frío o más calor hubo que combatir.'
	);
	return lines.join('\n');
}
