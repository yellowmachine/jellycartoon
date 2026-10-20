import { describe, expect, test } from 'bun:test';
import { cuesFromWhisper } from './whisper-cues.ts';

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

	test('gone when the next one comes, not both at once', () => {
		const quick = {
			segments: [
				{ start: 7, end: 8, text: ' $6?', words: [{ word: ' $6', t_dtw: 814 }] },
				{ start: 8, end: 9, text: ' I just had it.', words: [{ word: ' I', t_dtw: 868 }] }
			]
		};
		expect(cuesFromWhisper(quick)).toEqual([
			{ start: 7.69, end: 8.23, text: '$6?' },
			{ start: 8.23, end: 9.23, text: 'I just had it.' }
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
