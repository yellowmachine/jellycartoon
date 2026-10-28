import { expect, test } from 'bun:test';
import { DEFAULT_BOT_EVENTS, isBotEvent, parseBotEvents } from './telegram-bot.ts';

test('its events: all on unless turned off', () => {
	expect(parseBotEvents(null)).toEqual(DEFAULT_BOT_EVENTS);
	expect(parseBotEvents({ agenda: false })).toEqual({ ...DEFAULT_BOT_EVENTS, agenda: false });
});

test('only its own events', () => {
	expect(isBotEvent('temporizadores')).toBe(true);
	expect(isBotEvent('lista')).toBe(false);
});
