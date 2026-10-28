import { expect, test } from 'bun:test';
import { SAID_CHARS, telegramSaid, type TelegramMessage } from './telegram.ts';

const message = (m: Partial<TelegramMessage>): TelegramMessage => ({
	key: '1:1',
	from: 'Ana',
	chat: null,
	text: null,
	kind: 'texto',
	at: 0,
	...m
});

test('how a message is said to whoever drives', () => {
	expect(telegramSaid(message({ text: 'Llego en diez minutos' }))).toBe(
		'Mensaje de Ana: Llego en diez minutos'
	);
	expect(telegramSaid(message({ chat: 'Familia', text: 'Hola' }))).toBe(
		'Mensaje de Ana, en Familia: Hola'
	);
	expect(telegramSaid(message({ kind: 'foto' }))).toBe('Ana te ha mandado una foto.');
	expect(telegramSaid(message({ kind: 'foto', text: 'Mira' }))).toBe(
		'Ana te ha mandado una foto: Mira'
	);
	expect(telegramSaid(message({ text: 'a'.repeat(SAID_CHARS + 50) }))).toEndWith('… y sigue');
});
