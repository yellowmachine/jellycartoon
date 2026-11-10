import { describe, expect, test } from 'bun:test';
import { callReplySaid, hangUpSaid } from './call-voice.ts';

describe('callReplySaid', () => {
	test('answering, as Whisper writes it', () => {
		for (const said of [
			'Contesta.',
			'contéstale',
			'Cógelo',
			'Sí.',
			'Vale, cógela',
			'Descuelga',
			'Pásamela',
			'Contesta la llamada',
			'Sí, por favor'
		])
			expect(callReplySaid(said)).toBe('answer');
	});
	test('not answering', () => {
		for (const said of [
			'No contestes',
			'No.',
			'Ahora no',
			'Rechaza',
			'Cuélgala',
			'No la cojas',
			'Que llame luego',
			'Luego'
		])
			expect(callReplySaid(said)).toBe('reject');
	});
	test('anything else goes to the AI', () => {
		for (const said of [
			'Llama a mamá',
			'Pon la radio',
			'Sí, pon música',
			'No sé',
			'',
			'contesta a Pepe que llego tarde'
		])
			expect(callReplySaid(said)).toBeNull();
	});
});

describe('hangUpSaid', () => {
	test('ending the call', () => {
		for (const said of [
			'Cuelga.',
			'Cuelga la llamada',
			'Corta',
			'Termina la llamada',
			'Ya está',
			'Adiós'
		])
			expect(hangUpSaid(said)).toBe(true);
	});
	test('anything else', () => {
		for (const said of ['Pon la radio', 'Sube el volumen', 'Cuelga la ropa luego', ''])
			expect(hangUpSaid(said)).toBe(false);
	});
});
