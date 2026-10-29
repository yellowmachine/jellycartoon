import { describe, expect, test } from 'bun:test';
import { afterOrder, pickLearned } from './learned.ts';

const rule = (title: string, words: string[]) => ({ title, words });

describe('pickLearned', () => {
	test('few, all of them', () => {
		const few = [rule('La radio es Radio 3', ['radio']), rule('Una duración sola', ['hora'])];
		expect(pickLearned(few, 'pon algo')).toEqual(few);
	});

	test('many, those that share words, most first', () => {
		const many = Array.from({ length: 20 }, (_, i) => rule(`Otra ${i}`, [`cosa${i}`]));
		const timer = rule('Una duración sola es un temporizador', ['media', 'hora', 'minutos']);
		const radio = rule('La radio es Radio 3', ['radio', 'emisora']);
		const picked = pickLearned([...many, radio, timer], 'veinte minutos');
		expect(picked).toEqual([timer]);
		expect(pickLearned([...many, radio, timer], 'pon la emisora media hora')[0]).toBe(timer);
	});

	test('same first five letters: «temporizadores» brings «temporizador»', () => {
		const many = Array.from({ length: 20 }, (_, i) => rule(`Otra ${i}`, [`cosa${i}`]));
		const timer = rule('Una duración sola', ['temporizador']);
		expect(pickLearned([...many, timer], 'quita los temporizadores')).toEqual([timer]);
	});
});

describe('afterOrder', () => {
	const asked = { reply: '¿Temporizador o parar la música?', options: [], expectsAnswer: true };
	const done = { reply: 'Pongo un temporizador de media hora.', options: [], expectsAnswer: false };

	test('a question, then its answer', () => {
		expect(afterOrder('f:a', 'Media hora.', asked)).toBeNull();
		expect(afterOrder('f:a', 'Un temporizador.', done)).toEqual({
			said: 'Media hora.',
			question: asked.reply,
			options: [],
			answer: 'Un temporizador.',
			reply: done.reply
		});
		// Answered once.
		expect(afterOrder('f:a', 'Otra cosa.', done)).toBeNull();
	});

	test('each place its own', () => {
		afterOrder('f:b', 'Media hora.', asked);
		expect(afterOrder('f:c', 'Un temporizador.', done)).toBeNull();
		expect(afterOrder('f:b', 'Un temporizador.', done)).not.toBeNull();
	});
});
