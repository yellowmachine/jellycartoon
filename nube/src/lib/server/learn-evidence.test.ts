import { describe, expect, test } from 'bun:test';
import { repeatsOf } from './learn-evidence.ts';

/** What a proposed rule stands on (#331, phase 7): only what was really said, three times or more. */
const at = (day: string) => new Date(`${day}T10:00:00`);
const said = [
	{ text: 'Pongo la lavadora.', at: at('2026-10-26') },
	{ text: '¿Qué hora es?', at: at('2026-10-27') },
	{ text: 'Voy a poner la lavadora', at: at('2026-10-28') },
	{ text: 'pongo la lavadora, avísame en una hora', at: at('2026-10-30') },
	{ text: 'Recuérdame que es lo que es si no tengo puntado en la agenda.', at: at('2026-10-31') }
];

describe('what a proposed rule stands on', () => {
	test('three times or more: said, with the days', () => {
		const r = repeatsOf(said, ['poner la lavadora', 'pongo la lavadora']);
		expect(r?.count).toBe(3);
		expect(r?.because).toBe(
			'porque dijiste «poner la lavadora» y parecidas (lunes 26, miércoles 28, viernes 30)'
		);
	});

	test('fewer: not proposed', () => {
		expect(repeatsOf(said, ['qué hora es'])).toBeNull();
	});

	test('a phrase never said: made up, not proposed', () => {
		expect(repeatsOf(said, ['pongo la lavadora', 'pon la nevera'])).toBeNull();
	});

	test('none, or too short: not proposed', () => {
		expect(repeatsOf(said, [])).toBeNull();
		expect(repeatsOf(said, ['la'])).toBeNull();
	});
});
