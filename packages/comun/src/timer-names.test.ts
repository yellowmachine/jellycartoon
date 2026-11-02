import { expect, test } from 'bun:test';
import { describeTimers, formatLeft, sameLabel, spokenAgo, timeLabel } from './timer-names.ts';

test('timeLabel: a name from the time, for one with no name', () => {
	expect(timeLabel(300)).toBe('5 minutos');
	expect(timeLabel(60)).toBe('1 minuto');
	expect(timeLabel(30)).toBe('30 segundos');
	expect(timeLabel(90)).toBe('1 minuto y 30 segundos');
	expect(timeLabel(5400)).toBe('1 hora y 30 minutos');
	expect(timeLabel(3661)).toBe('1 hora, 1 minuto y 1 segundo');
});

test('formatLeft', () => {
	expect(formatLeft(425)).toBe('7:05');
	expect(formatLeft(3750)).toBe('1:02:30');
	expect(formatLeft(-3)).toBe('0:00');
});

test('sameLabel ignores case and accents', () => {
	expect(sameLabel('La Pasta', 'la pasta')).toBe(true);
	expect(sameLabel('el jamón', 'el jamon')).toBe(true);
	expect(sameLabel('el arroz', 'la pasta')).toBe(false);
});

test('spokenAgo: minutes, and hours once past one', () => {
	expect(spokenAgo(25 * 60)).toBe('25 min');
	expect(spokenAgo(2 * 3600 + 10 * 60)).toBe('2 h 10 min');
	expect(spokenAgo(3 * 3600)).toBe('3 h');
});

test('a timer that rang hours ago is told in hours, with what it was', () => {
	const now = Date.parse('2026-11-02T12:00:00Z');
	const [line] = describeTimers(
		{
			done: [{ label: 'la cerveza del congelador', how: 'sonó', at: now - 2 * 3600_000 }],
			running: [],
			ringing: [],
			prepared: []
		},
		now
	);
	expect(line).toBe(
		'la cerveza del congelador, ya sonó y se paró hace 2 h: no lo vuelvas a poner si no lo pide'
	);
});
