import { expect, test } from 'bun:test';
import { formatLeft, sameLabel, timeLabel } from './timer-names.ts';

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
