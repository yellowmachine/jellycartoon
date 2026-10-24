import { expect, test } from 'bun:test';
import { AGE_BANDS, checkProposal, clock, fromClock, mark, transcript } from './homework.ts';

const [infantil, primero, tercero] = AGE_BANDS;
const asked = { band: tercero, episodeIds: [7, 8] };
/** The right option where it was: random() → 0 puts it first. */
const first = () => 0;

test('where it is in the episode, both ways', () => {
	expect(clock(754)).toBe('12:34');
	expect(clock(3723)).toBe('1:02:03');
	expect(fromClock('12:34')).toBe(754);
	expect(fromClock('1:02:03')).toBe(3723);
	expect(fromClock('ayer')).toBeNull();
	expect(fromClock(754)).toBeNull();
});

test('the dialogue for the AI: where each line is, without songs, sounds or a line said twice', () => {
	const cues = [
		{ start: 1, end: 2, text: '♪ Scooby Dooby Doo ♪' },
		{ start: 62, end: 64, text: '¡Zoinks!\n[gritos]' },
		{ start: 64, end: 65, text: '¡Zoinks!' },
		{ start: 70, end: 72, text: 'Hay que encontrar  al fantasma.' }
	];
	expect(transcript(cues)).toBe('[1:02] ¡Zoinks!\n[1:10] Hay que encontrar al fantasma.');
	expect(transcript(cues, 20)).toBe('[1:02] ¡Zoinks!');
});

test('a choice: kept with as many options as the age has, the right one in a random place', () => {
	const [e] = checkProposal(
		[
			{
				kind: 'choice',
				question: '¿Quién era el fantasma?',
				options: ['El jardinero', 'El alcalde', 'Shaggy', 'Nadie'],
				answer: 1,
				hint: 'Fíjate en quién huyó.',
				episode: 7,
				at: '18:20'
			}
		],
		{ band: primero, episodeIds: [7] },
		() => 0.99
	);
	expect(e).toEqual({
		kind: 'choice',
		question: '¿Quién era el fantasma?',
		options: ['El jardinero', 'Shaggy', 'El alcalde'],
		answer: 2,
		hint: 'Fíjate en quién huyó.',
		expected: null,
		episodeId: 7,
		at: 1100
	});
});

test('true or false, and an open one for an adult to read', () => {
	const exercises = checkProposal(
		[
			{ kind: 'truefalse', question: 'Scooby tiene miedo.', answer: true, episode: 8 },
			{ kind: 'open', question: '¿Por qué huyó Shaggy?', expected: 'Por el fantasma.', episode: 8 }
		],
		asked,
		first
	);
	expect(exercises.map((e) => [e.kind, e.options, e.answer, e.expected])).toEqual([
		['truefalse', ['Verdadero', 'Falso'], 0, null],
		['open', [], null, 'Por el fantasma.']
	]);
});

test('what does not hold together is left out', () => {
	const proposed = [
		// The answer is not among the options.
		{ kind: 'choice', question: 'Uno', options: ['a', 'b'], answer: 5, episode: 7 },
		// Two options the same.
		{ kind: 'choice', question: 'Dos', options: ['a', 'a'], answer: 0, episode: 7 },
		// An episode not asked for.
		{ kind: 'truefalse', question: 'Tres', answer: true, episode: 99 },
		// Not a yes or a no.
		{ kind: 'truefalse', question: 'Cuatro', answer: 'sí', episode: 7 },
		// A kind there is not.
		{ kind: 'essay', question: 'Cinco', episode: 7 },
		// No question.
		{ kind: 'truefalse', question: '  ', answer: false, episode: 7 },
		// Kept, and then the same question again.
		{ kind: 'truefalse', question: 'Seis', answer: false, episode: 7 },
		{ kind: 'truefalse', question: 'seis', answer: true, episode: 7 }
	];
	expect(checkProposal(proposed, asked, first).map((e) => e.question)).toEqual(['Seis']);
	expect(checkProposal('nada', asked)).toEqual([]);
});

test('an age that does not write gets no open ones', () => {
	const open = [{ kind: 'open', question: '¿Qué pasó?', episode: 7 }];
	expect(checkProposal(open, { band: infantil, episodeIds: [7] })).toEqual([]);
	expect(checkProposal(open, asked)).toHaveLength(1);
});

test('marked: the closed ones by themselves, the open ones wait for an adult', () => {
	const exercises = checkProposal(
		[
			{ kind: 'truefalse', question: 'A', answer: true, episode: 7 },
			{ kind: 'truefalse', question: 'B', answer: false, episode: 7 },
			{ kind: 'choice', question: 'C', options: ['x', 'y'], answer: 0, episode: 7 },
			{ kind: 'open', question: 'D', episode: 7 },
			{ kind: 'open', question: 'E', episode: 7 }
		],
		asked,
		first
	);
	expect(mark(exercises, [0, 0, null, 'Porque sí', '  '])).toEqual({
		right: 1,
		closed: 3,
		toRead: 1,
		left: 2
	});
});
