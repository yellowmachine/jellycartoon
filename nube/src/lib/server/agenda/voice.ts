import {
	addDays,
	dayName,
	isDay,
	isTime,
	localDay,
	localTime,
	parseEventInput
} from 'comun/agenda.ts';
import {
	daysName,
	MAX_ALARM_LABEL,
	MAX_SKIP_DAYS,
	MAX_SNOOZE_MIN,
	parseAlarmInput,
	SNOOZE_MIN,
	type AlarmPlace
} from 'comun/alarms.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import {
	addAlarm,
	canTouch,
	deleteAlarm,
	editAlarm,
	setPaused,
	skipAlarm,
	snoozeAlarm,
	stopAlarm,
	unskipAlarm
} from '#lib/server/alarms/alarms.ts';
import { addEvent, dayForVoice, personByName, personOf } from './agenda.ts';

/**
 * What the house's voice does with the agenda and the alarms (jellycartoon's command.ts, #200 and
 * #241), here where they are: the AI's arguments as it gave them, and what to tell it back.
 */

type Args = Record<string, unknown>;

/** «Apunta el dentista de Lucía el jueves a las cinco». */
export async function addEventByVoice(k: Kitchen, args: Args) {
	const people: string[] = [];
	const unknown: string[] = [];
	for (const name of Array.isArray(args.people) ? args.people : []) {
		const found = typeof name === 'string' ? await personByName(k, name) : null;
		if (found) people.push(found.id);
		else unknown.push(String(name));
	}
	const time = isTime(args.time) ? args.time : null;
	const input = parseEventInput({
		title: args.title,
		startDay: args.day,
		startTime: time,
		repeat:
			args.repeat === 'semana'
				? { every: 'semana', days: args.weekdays ?? [] }
				: args.repeat === 'mes' || args.repeat === 'año'
					? { every: args.repeat }
					: null,
		remind: args.remind,
		people
	});
	if (!input) return 'Falta qué es o el día (YYYY-MM-DD).';
	await addEvent(k, input);
	return [
		`Apuntado en la agenda: ${input.title}, el ${dayName(input.startDay, true)}${time ? ` a las ${time}` : ''}.`,
		unknown.length
			? `No hay nadie en la familia llamado ${unknown.join(' ni ')}: no se ha puesto para quién.`
			: ''
	]
		.filter(Boolean)
		.join(' ');
}

/** «¿Qué tenemos mañana?»; a child (`kid`, their name), only theirs. */
export async function agendaByVoice(k: Kitchen, args: Args, kid: string | null) {
	if (!isDay(args.from)) return 'Falta desde qué día (YYYY-MM-DD).';
	const last = isDay(args.to) && args.to >= args.from ? args.to : args.from;
	const days: string[] = [];
	for (let day = args.from; day <= last && days.length < 32; day = addDays(day, 1)) days.push(day);
	const child = kid ? await personByName(k, kid) : null;
	const lines = await Promise.all(
		days.map(async (day) => {
			const events = await dayForVoice(k, day, child ? Number(child.id) : null);
			return events.length ? `${dayName(day, true)}: ${events.join('; ')}` : null;
		})
	);
	const found = lines.filter(Boolean);
	return found.length ? found.join('\n') : 'Nada apuntado esos días.';
}

/**
 * «Despiértame a las 7»: where it is said (`place`, a satellite's; null, a phone), of who speaks
 * unless said otherwise (from a satellite, the house's).
 */
export async function setAlarmByVoice(k: Kitchen, args: Args, place: AlarmPlace | null) {
	if (!isTime(args.time)) return 'Falta la hora, como HH:MM.';
	const days = Array.isArray(args.days)
		? args.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
		: [];
	let day = isDay(args.day) ? args.day : localDay();
	// Once, at a time already gone today: tomorrow.
	if (!days.length && day === localDay() && args.time <= localTime()) day = addDays(day, 1);
	const asked = typeof args.for === 'string' ? args.for.trim() : '';
	let people: string[];
	if (/^(la )?casa$/i.test(asked)) people = [];
	else if (asked) {
		const found = await personByName(k, asked);
		if (!found) return `No hay nadie llamado «${asked}» en la familia.`;
		people = [found.id];
	} else {
		const me = place || !k.userId ? null : await personOf(k, k.userId);
		people = me ? [me] : [];
	}
	const input = parseAlarmInput({
		kind: 'alarma',
		time: args.time,
		day,
		days,
		label: typeof args.label === 'string' ? args.label : '',
		people,
		place: place ?? 'casa'
	});
	if (!input || input.kind !== 'alarma') return 'Alarma no válida.';
	const id = await addAlarm(k, input);
	return `Alarma ${id} «${input.label}» puesta: a las ${input.time}, ${days.length ? daysName(days).toLowerCase() : `el ${dayName(day)}`}; ${people.length ? 'de una persona' : 'de la casa'}.`;
}

/** «Quítala», «mañana no», «cámbiala a las 6:30», «pospón»…, by its number. */
export async function changeAlarmByVoice(k: Kitchen, args: Args, satellite: boolean) {
	const id = Number(args.id);
	// From a satellite, only the house's; from a phone, the house's and theirs.
	const me = satellite || !k.userId ? null : await personOf(k, k.userId);
	if (!Number.isInteger(id) || !(await canTouch(k, id, me))) return `No hay alarma ${args.id}.`;
	switch (args.do) {
		case 'delete':
			await deleteAlarm(k, id);
			return `Alarma ${id} quitada.`;
		case 'skip': {
			const from = typeof args.from === 'string' && args.from ? args.from : undefined;
			const to = typeof args.to === 'string' && args.to ? args.to : undefined;
			const days = await skipAlarm(k, id, from, to);
			if (!days)
				return `No se puede: fechas no válidas (AAAA-MM-DD, hasta ${MAX_SKIP_DAYS} días) o no le queda ninguna vez.`;
			if (!days.length) return `La alarma ${id} no suena esos días: nada que saltar.`;
			return `La alarma ${id} no sonará: ${days.join(', ')}; los demás días, sí.`;
		}
		case 'unskip': {
			const from = typeof args.from === 'string' ? args.from : '';
			const to = typeof args.to === 'string' && args.to ? args.to : undefined;
			const days = await unskipAlarm(k, id, from, to);
			if (!days) return 'Falta el día, AAAA-MM-DD, o no es válido.';
			return days.length
				? `La alarma ${id} vuelve a sonar: ${days.join(', ')}.`
				: `La alarma ${id} no se saltaba esos días: ya suena.`;
		}
		case 'snooze': {
			const minutes = args.minutes === undefined ? SNOOZE_MIN : Math.round(Number(args.minutes));
			if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_SNOOZE_MIN)
				return `Minutos no válidos: de 1 a ${MAX_SNOOZE_MIN}.`;
			const at = await snoozeAlarm(k, id, minutes);
			return at
				? `Alarma ${id} pospuesta: vuelve a sonar a las ${localTime(at)}, dentro de ${minutes} minutos.`
				: `La alarma ${id} no está sonando ni acaba de sonar: no hay nada que posponer.`;
		}
		case 'edit': {
			const time =
				typeof args.time === 'string' && args.time ? args.time.trim().padStart(5, '0') : undefined;
			const day = typeof args.day === 'string' && args.day ? args.day.trim() : undefined;
			const days = Array.isArray(args.days)
				? [...new Set(args.days.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
				: undefined;
			const label =
				typeof args.label === 'string' && args.label.trim()
					? args.label.trim().slice(0, MAX_ALARM_LABEL)
					: undefined;
			if (time !== undefined && !isTime(time)) return `Hora no válida: «${time}», HH:MM.`;
			if (day !== undefined && !isDay(day)) return `Día no válido: «${day}», AAAA-MM-DD.`;
			const now = await editAlarm(k, id, { time, days, day, label });
			return now ? `Alarma ${id} cambiada: ${now}.` : `No hay alarma ${id}.`;
		}
		case 'pause':
			await setPaused(k, id, true);
			return `Alarma ${id} pausada.`;
		case 'resume':
			await setPaused(k, id, false);
			return `Alarma ${id} activada de nuevo.`;
		case 'stop':
			await stopAlarm(k, id);
			return `Alarma ${id} parada.`;
	}
	return 'Acción no válida.';
}
