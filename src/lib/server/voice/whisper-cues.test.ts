import { describe, expect, test } from 'bun:test';
import { phrasesFromWhisper, readableCues } from './whisper-cues.ts';

// The start of Friends S3E17 as whisper-server (-dtw) gave it: phrases on whole seconds, before
// they are said.
const FRIENDS = {
	segments: [
		{
			start: 0,
			end: 2,
			text: ' - Hi.',
			words: [
				{ word: ' -', t_dtw: 318 },
				{ word: ' Hi', t_dtw: 330 },
				{ word: '.', t_dtw: 388 }
			]
		},
		{
			start: 6,
			end: 7,
			text: ' - Six dollars, please.',
			words: [
				{ word: ' -', t_dtw: 388 },
				{ word: ' Six', t_dtw: 684 },
				{ word: ' dollars', t_dtw: 710 },
				{ word: ',', t_dtw: 732 },
				{ word: ' please', t_dtw: 746 },
				{ word: '.', t_dtw: 780 }
			]
		},
		{
			start: 7,
			end: 9,
			text: " - Six? I just had it for one night. It's three.",
			words: [
				{ word: ' -', t_dtw: 788 },
				{ word: ' Six', t_dtw: 818 },
				{ word: '?', t_dtw: 838 },
				{ word: ' I', t_dtw: 866 }
			]
		}
	]
};

describe('phrasesFromWhisper', () => {
	test('a phrase starts a little before its first word, not at the dash of a dialogue', () => {
		expect(phrasesFromWhisper(FRIENDS).map((c) => c.start)).toEqual([2.85, 6.39, 7.73]);
	});

	test('at least a second, if its first word comes near its end', () => {
		const [hi, six, three] = phrasesFromWhisper(FRIENDS);
		expect(hi!.end).toBe(3.85);
		expect(six!.end).toBe(7.39);
		expect(three).toEqual({
			start: 7.73,
			end: 9,
			text: "- Six? I just had it for one night. It's three."
		});
	});

	test('noise and music are not words to read', () => {
		const laughs = {
			segments: [
				{ start: 20, end: 21, text: ' Kiss her.' },
				{ start: 21, end: 22, text: ' (audience laughing)' },
				{ start: 22, end: 25, text: " ♪ I'll be there for you ♪" },
				{ start: 25, end: 26, text: ' [music playing]' }
			]
		};
		expect(phrasesFromWhisper(laughs).map((c) => c.text)).toEqual([
			'Kiss her.',
			"I'll be there for you"
		]);
	});

	test("without -dtw, Whisper's own times", () => {
		const off = {
			segments: [
				{ start: 6, end: 7, text: ' Six dollars.', words: [{ word: ' Six', t_dtw: -1 }] },
				{ start: 8, end: 9, text: ' Please.' }
			]
		};
		expect(phrasesFromWhisper(off)).toEqual([
			{ start: 6, end: 7, text: 'Six dollars.' },
			{ start: 8, end: 9, text: 'Please.' }
		]);
	});

	test('empty phrases are left out', () => {
		expect(phrasesFromWhisper({ segments: [{ start: 0, end: 1, text: '  ' }] })).toEqual([]);
	});
});

describe('readableCues: rolling up', () => {
	const p = (start: number, end: number, text: string) => ({ start, end, text });

	test('quick talk: the one being said below, the one before above, until the next', () => {
		const talk = [
			p(103, 104, 'Has she slept at all?'),
			p(104.4, 105, 'Nope.'),
			p(105, 107, "No, it's been three nights in a row.")
		];
		expect(readableCues(talk)).toEqual([
			{ start: 103, end: 104.4, text: 'Has she slept at all?' },
			{ start: 104.4, end: 105, text: 'Has she slept at all?\nNope.' },
			{ start: 105, end: 107.4, text: "Nope.\nNo, it's been three nights in a row." }
		]);
	});

	test('with nobody talking, the last one stays until it can be read, then goes', () => {
		// 48 characters at 15 a second: 3.2 s, though it was said in 2.
		const [cue] = readableCues([
			p(71.77, 73.77, 'I have to say "Toop-A-Lo Honey" by Van Morrison.')
		]);
		expect(cue!.end).toBe(74.97);
		// A short one, at least a second and a half.
		expect(readableCues([p(10, 10.5, 'Hi.')])[0]!.end).toBe(11.5);
	});

	test('after a pause, a new one starts alone', () => {
		const [, second] = readableCues([p(10, 11, 'Hi.'), p(20, 21, 'Where were you?')]);
		expect(second!.text).toBe('Where were you?');
	});

	test('never more than two lines', () => {
		const burst = readableCues([p(5, 5.2, 'Oh.'), p(5.2, 5.4, 'Hey.'), p(5.4, 6, 'Hi!')]);
		expect(burst.map((c) => c.text)).toEqual(['Oh.', 'Oh.\nHey.', 'Hey.\nHi!']);
		expect(burst.every((c) => c.end > c.start)).toBe(true);
	});

	test('in order, though Whisper gave them out of it; two at once, shown together', () => {
		const cues = readableCues([p(3, 4, 'B.'), p(1, 2, 'A.'), p(3.01, 4, 'C.')]);
		expect(cues.map((c) => c.text)).toEqual(['A.', 'B.\nC.']);
	});
});
