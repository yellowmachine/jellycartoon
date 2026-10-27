import { expect, test } from 'bun:test';
import { DEFAULT_BOT_EVENTS, listSaid, parseBotEvents } from './telegram-bot.ts';

test('what the bot says of the shopping list', () => {
	expect(listSaid('María', 'añadido', ['leche'])).toBe('🛒 María ha añadido a la lista: leche');
	expect(listSaid('María', 'añadido', ['leche', 'pan', 'huevos'])).toBe(
		'🛒 María ha añadido a la lista: leche, pan y huevos'
	);
	expect(listSaid(null, 'comprado', ['leche'])).toBe('✓ Alguien ha comprado: leche');
});

test('its events: all on unless turned off', () => {
	expect(parseBotEvents(null)).toEqual(DEFAULT_BOT_EVENTS);
	expect(parseBotEvents({ nevera: false })).toEqual({ ...DEFAULT_BOT_EVENTS, nevera: false });
});
