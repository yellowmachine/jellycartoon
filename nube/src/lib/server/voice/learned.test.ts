import { describe, expect, test } from 'bun:test';
import { afterOrder, assumedNote, pickLearned, sharesWords } from './learned.ts';

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

describe('sharesWords', () => {
	const radio = rule('«La radio» es la COPE aquí', ['radio', 'emisora', 'cope']);
	test('«para» has nothing of it; «por la radio», yes', () => {
		expect(sharesWords('Para.', radio)).toBe(false);
		expect(sharesWords('Por la radio.', radio)).toBe(true);
	});
});

describe('afterOrder', () => {
	const asked = { reply: '¿Temporizador o parar la música?', options: [], expectsAnswer: true };
	const done = { reply: 'Pongo un temporizador de media hora.', options: [], expectsAnswer: false };

	test('a question, then its answer', () => {
		expect(afterOrder('f:a', 'Media hora.', asked, [])).toBeNull();
		expect(afterOrder('f:a', 'Un temporizador.', done, [])).toEqual({
			kind: 'answer',
			said: 'Media hora.',
			question: asked.reply,
			options: [],
			answer: 'Un temporizador.',
			reply: done.reply
		});
		// Answered once.
		expect(afterOrder('f:a', 'Otra cosa.', done, [])).toBeNull();
	});

	test('asked again: the first order, and the last question', () => {
		const again = {
			reply: '«La Coppa» no es una emisora. ¿Cuál quieres?',
			options: [],
			expectsAnswer: true
		};
		const radio = { reply: 'Pongo la COPE.', options: [], expectsAnswer: false };
		afterOrder('f:e', 'Pon la radio.', asked, []);
		expect(afterOrder('f:e', 'La Coppa.', again, [])).toBeNull();
		expect(afterOrder('f:e', 'La COPE.', radio, [])).toMatchObject({
			said: 'Pon la radio.',
			question: again.reply,
			answer: 'La COPE.'
		});
	});

	test('each place its own', () => {
		afterOrder('f:b', 'Media hora.', asked, []);
		expect(afterOrder('f:c', 'Un temporizador.', done, [])).toBeNull();
		expect(afterOrder('f:b', 'Un temporizador.', done, [])).not.toBeNull();
	});

	test('done by what was learned, then what follows it', () => {
		const used = [{ id: 3, title: 'Una duración sola es un temporizador', rule: '…' }];
		expect(afterOrder('f:d', 'Veinte minutos.', done, used)).toBeNull();
		expect(assumedNote('f:d')).toContain('«Una duración sola es un temporizador»');
		const stop = {
			reply: 'Quito el temporizador y paro la música en 20 minutos.',
			options: [],
			expectsAnswer: false
		};
		expect(afterOrder('f:d', 'No, la música.', stop, [])).toEqual({
			kind: 'after',
			said: 'Veinte minutos.',
			reply: done.reply,
			used,
			next: 'No, la música.',
			nextReply: stop.reply
		});
		expect(assumedNote('f:d')).toBeNull();
	});
});
