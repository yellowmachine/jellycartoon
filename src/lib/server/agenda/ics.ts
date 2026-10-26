import { addDays } from '#lib/agenda.ts';

/**
 * The agenda as an iCalendar file (RFC 5545, https://www.rfc-editor.org/rfc/rfc5545), for the
 * phones' calendars to subscribe to: read only. Times are «floating» (no zone, §3.3.5): the hour
 * on the wall, as they are saved; X-WR-TIMEZONE says the house's, for the calendars that ask.
 */

export interface IcsEvent {
	id: number;
	title: string;
	notes: string | null;
	names: string;
	startDay: string;
	startTime: string | null;
	endDay: string | null;
	endTime: string | null;
	repeatRule: string | null;
	skipDays: string[];
	createdAt: Date;
}

/** TEXT, escaped (§3.3.11). */
const text = (value: string) =>
	value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 octets, folded (§3.1): a space starts each one that goes on. */
function fold(line: string) {
	const bytes = new TextEncoder();
	const parts: string[] = [];
	let part = '';
	for (const char of line) {
		const limit = parts.length ? 74 : 75;
		if (bytes.encode(part + char).length > limit) {
			parts.push(part);
			part = '';
		}
		part += char;
	}
	parts.push(part);
	return parts.join('\r\n ');
}

const date = (day: string) => day.replaceAll('-', '');
const dateTime = (day: string, time: string) => `${date(day)}T${time.replace(':', '')}00`;
const utcStamp = (at: Date) => `${at.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;

/** An hour later, on the same day or the next. */
function hourLater(day: string, time: string) {
	const [h, m] = time.split(':').map(Number);
	const at = new Date(Date.UTC(2000, 0, 1, h! + 1, m!));
	return {
		day: at.getUTCDate() === 1 ? day : addDays(day, 1),
		time: at.toISOString().slice(11, 16)
	};
}

function vevent(e: IcsEvent, host: string) {
	const lines = ['BEGIN:VEVENT', `UID:evento-${e.id}@${host}`, `DTSTAMP:${utcStamp(e.createdAt)}`];
	if (!e.startTime) {
		// All day: DTEND is the day after the last (§3.6.1).
		lines.push(`DTSTART;VALUE=DATE:${date(e.startDay)}`);
		lines.push(`DTEND;VALUE=DATE:${date(addDays(e.endDay ?? e.startDay, 1))}`);
	} else {
		lines.push(`DTSTART:${dateTime(e.startDay, e.startTime)}`);
		const end = e.endTime
			? { day: e.endDay ?? e.startDay, time: e.endTime }
			: e.endDay
				? { day: e.endDay, time: '23:59' }
				: hourLater(e.startDay, e.startTime);
		lines.push(`DTEND:${dateTime(end.day, end.time)}`);
	}
	if (e.repeatRule) {
		lines.push(`RRULE:${e.repeatRule}`);
		for (const day of e.skipDays)
			lines.push(
				e.startTime ? `EXDATE:${dateTime(day, e.startTime)}` : `EXDATE;VALUE=DATE:${date(day)}`
			);
	}
	lines.push(`SUMMARY:${text(e.title)}`);
	const description = [e.names && `Para: ${e.names}`, e.notes].filter(Boolean).join('\n');
	if (description) lines.push(`DESCRIPTION:${text(description)}`);
	lines.push('END:VEVENT');
	return lines;
}

export function toIcs(events: IcsEvent[], { host, zone }: { host: string; zone: string }) {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//JellyCartoon//Agenda//ES',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'X-WR-CALNAME:Agenda de casa',
		`X-WR-TIMEZONE:${zone}`,
		...events.flatMap((e) => vevent(e, host)),
		'END:VCALENDAR'
	];
	return `${lines.map(fold).join('\r\n')}\r\n`;
}
