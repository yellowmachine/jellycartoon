import { expect, test } from 'bun:test';
import { CHAT_HISTORY, firstRead } from './chat.ts';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const ago = (minutes: number) => ({ createdAt: new Date(NOW - minutes * 60_000) });

test('the AI reads from the first message of the last two hours', () => {
	expect(firstRead([ago(300), ago(130), ago(110), ago(5)], NOW)).toBe(2);
});

test('all recent: from the first; all old: none (its length); empty: 0', () => {
	expect(firstRead([ago(30), ago(10)], NOW)).toBe(0);
	expect(firstRead([ago(300), ago(200)], NOW)).toBe(2);
	expect(firstRead([], NOW)).toBe(0);
});

test('never more than the last CHAT_HISTORY, recent as they are', () => {
	const many = Array.from({ length: CHAT_HISTORY + 5 }, () => ago(1));
	expect(firstRead(many, NOW)).toBe(5);
});

test('the dates as the page gets them, in JSON', () => {
	expect(
		firstRead([{ createdAt: new Date(NOW - 3 * 3_600_000).toISOString() as never }], NOW)
	).toBe(1);
});
