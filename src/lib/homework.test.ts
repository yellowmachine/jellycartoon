import { expect, test } from 'bun:test';
import {
	AGE_BANDS,
	DEFAULT_RULES,
	checkEdited,
	checkProposal,
	checkRules,
	clock,
	fromClock,
	mark,
	transcript,
	tryAnswer
} from './homework.ts';

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

test('in English, «True» and «False»', () => {
	const [e] = checkProposal(
		[{ kind: 'truefalse', question: 'Scooby is scared.', answer: false, episode: 7 }],
		{ ...asked, language: 'en' }
	);
	expect([e?.options, e?.answer]).toEqual([['True', 'False'], 1]);
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

test('a try: right; wrong with tries left, its hint; wrong at the last, the right one', () => {
	const [e] = checkProposal(
		[
			{
				kind: 'choice',
				question: '¿Quién?',
				options: ['A', 'B'],
				answer: 0,
				hint: 'Piensa.',
				episode: 7
			}
		],
		asked,
		first
	);
	const rules = { tries: 2, hints: true, showAnswer: true };
	expect(tryAnswer(e!, 0, 1, rules)).toEqual({ result: 'right' });
	expect(tryAnswer(e!, 1, 1, rules)).toEqual({ result: 'again', hint: 'Piensa.' });
	expect(tryAnswer(e!, 1, 2, rules)).toEqual({ result: 'wrong', right: 0 });
	expect(tryAnswer(e!, 1, 1, { ...rules, hints: false })).toEqual({ result: 'again', hint: null });
	expect(tryAnswer(e!, 1, 2, { ...rules, showAnswer: false })).toEqual({
		result: 'wrong',
		right: null
	});
	expect(tryAnswer(e!, 1, 9, { ...rules, tries: null }).result).toBe('again');
});

test('the rules from a form: what is not valid, as by default', () => {
	expect(checkRules({ tries: 3, hints: false, showAnswer: false })).toEqual({
		tries: 3,
		hints: false,
		showAnswer: false
	});
	expect(checkRules({ tries: null })).toEqual({ tries: null, hints: true, showAnswer: true });
	expect(checkRules({ tries: 7, hints: 'sí' })).toEqual(DEFAULT_RULES);
});

test('edited by an adult: the right one where they put it; what does not hold, out', () => {
	const edited = [
		{
			kind: 'choice',
			question: '¿Quién?',
			options: ['A', ' B ', ''],
			answer: 1,
			episodeId: 7,
			at: 30
		},
		{ kind: 'choice', question: 'Mal', options: ['A', 'B'], answer: 4, episodeId: 7 },
		{ kind: 'truefalse', question: 'Es verdad', options: [], answer: 1, episodeId: 7 },
		{ kind: 'open', question: '¿Por qué?', expected: 'Porque sí', episodeId: 7 },
		{ kind: 'open', question: 'Otro', episodeId: 99 }
	];
	expect(checkEdited(edited, { episodeIds: [7] })).toEqual([
		{
			kind: 'choice',
			question: '¿Quién?',
			options: ['A', 'B'],
			answer: 1,
			hint: null,
			expected: null,
			episodeId: 7,
			at: 30
		},
		{
			kind: 'truefalse',
			question: 'Es verdad',
			options: ['Verdadero', 'Falso'],
			answer: 1,
			hint: null,
			expected: null,
			episodeId: 7,
			at: null
		},
		{
			kind: 'open',
			question: '¿Por qué?',
			options: [],
			answer: null,
			hint: null,
			expected: 'Porque sí',
			episodeId: 7,
			at: null
		}
	]);
});
