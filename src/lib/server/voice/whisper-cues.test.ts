import { describe, expect, test } from 'bun:test';
import { phrasesFromWhisper, readableCues, type WhisperVerbose } from './whisper-cues.ts';

const cuesFromWhisper = (body: WhisperVerbose) => readableCues(phrasesFromWhisper(body));

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

describe('cuesFromWhisper', () => {
	test('a phrase starts a little before its first word, not at the dash of a dialogue', () => {
		expect(cuesFromWhisper(FRIENDS).map((c) => c.start)).toEqual([2.85, 6.39, 7.73]);
	});

	test('on screen at least a second, if its first word comes near its end', () => {
		const [hi, six, three] = cuesFromWhisper(FRIENDS);
		expect(hi!.end).toBe(3.85);
		expect(six!.end).toBe(7.39);
		expect(three).toEqual({
			start: 7.73,
			end: 9,
			text: "- Six? I just had it for one night. It's three."
		});
	});

	/** A phrase as whisper-server gives it: Whisper's own times, and its first word by DTW. */
	const phrase = (text: string, at: number, end = Math.ceil(at + 1)) => ({
		start: Math.floor(at),
		end,
		text: ` ${text}`,
		words: [{ word: ` ${text.split(' ')[0]}`, t_dtw: Math.round((at + 0.45) * 100) }]
	});

	test('two quick ones, too short apart to read, in one cue: a line each', () => {
		const quick = { segments: [phrase('$6?', 7.69), phrase('I just had it.', 8.23)] };
		expect(cuesFromWhisper(quick)).toEqual([{ start: 7.69, end: 10, text: '$6?\nI just had it.' }]);
	});

	test('a second or more apart: the one before goes when the next comes', () => {
		const apart = { segments: [phrase('Hi.', 0, 3), phrase('How are you?', 1.5)] };
		expect(cuesFromWhisper(apart)).toEqual([
			{ start: 0, end: 1.5, text: 'Hi.' },
			{ start: 1.5, end: 3, text: 'How are you?' }
		]);
	});

	test('too long for one cue: the next waits until the one before has been a second on screen', () => {
		const long = {
			segments: [
				phrase('I met this really cute guy in the park, and he jogs and swims.', 10),
				phrase('And what are you gonna do for him?', 10.3)
			]
		};
		expect(cuesFromWhisper(long).map((c) => [c.start, c.end])).toEqual([
			[10, 11],
			[11, 12]
		]);
	});

	test('never more than two lines', () => {
		const burst = { segments: [phrase('Oh.', 5), phrase('Hey.', 5.2), phrase('Hi!', 5.4)] };
		expect(cuesFromWhisper(burst)).toEqual([
			{ start: 5, end: 6, text: 'Oh.\nHey.' },
			{ start: 6, end: 7, text: 'Hi!' }
		]);
	});

	test('noise and music are not words to read, nor cut the phrase before', () => {
		const laughs = {
			segments: [
				phrase('Kiss her.', 20),
				phrase('(audience laughing)', 20.3),
				phrase("♪ I'll be there for you ♪", 22),
				phrase('[music playing]', 25)
			]
		};
		expect(cuesFromWhisper(laughs)).toEqual([
			{ start: 20, end: 21, text: 'Kiss her.' },
			{ start: 22, end: 23, text: "I'll be there for you" }
		]);
	});

	test("without -dtw, Whisper's own times", () => {
		const off = {
			segments: [
				{ start: 6, end: 7, text: ' Six dollars.', words: [{ word: ' Six', t_dtw: -1 }] },
				{ start: 8, end: 9, text: ' Please.' }
			]
		};
		expect(cuesFromWhisper(off)).toEqual([
			{ start: 6, end: 7, text: 'Six dollars.' },
			{ start: 8, end: 9, text: 'Please.' }
		]);
	});

	test('empty phrases are left out', () => {
		expect(cuesFromWhisper({ segments: [{ start: 0, end: 1, text: '  ' }] })).toEqual([]);
	});
});
