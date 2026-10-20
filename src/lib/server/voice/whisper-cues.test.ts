import { describe, expect, test } from 'bun:test';
import { formCues, phrasesFromVtt, phrasesFromWhisper } from './whisper-cues.ts';
import { serializeVtt } from '#lib/vtt.ts';

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

const p = (start: number, end: number, text: string) => ({ start, end, text });
/** What is on screen: each cue's lines. */
const lines = (cues: ReturnType<typeof formCues>) =>
	cues.map((c) => (c.previous === undefined ? c.text : `${c.previous}\n${c.text}`));

describe('formCues: rolled up', () => {
	test('quick talk: the one being said below, the one before above, until the next', () => {
		const talk = [
			p(103, 104, 'Has she slept at all?'),
			p(104.4, 105, 'Nope.'),
			p(105, 107, "No, it's been three nights in a row.")
		];
		expect(formCues(talk, 'rollup')).toEqual([
			{ start: 103, end: 104.4, text: 'Has she slept at all?' },
			{ start: 104.4, end: 105, text: 'Nope.', previous: 'Has she slept at all?' },
			{ start: 105, end: 107.4, text: "No, it's been three nights in a row.", previous: 'Nope.' }
		]);
	});

	test('with nobody talking, the last one stays until it can be read, then goes', () => {
		// 48 characters at 15 a second: 3.2 s, though it was said in 2.
		const [cue] = formCues(
			[p(71.77, 73.77, 'I have to say "Toop-A-Lo Honey" by Van Morrison.')],
			'rollup'
		);
		expect(cue!.end).toBe(74.97);
		// A short one, at least a second and a half.
		expect(formCues([p(10, 10.5, 'Hi.')], 'rollup')[0]!.end).toBe(11.5);
	});

	test('after a pause, a new one starts alone', () => {
		const [, second] = formCues([p(10, 11, 'Hi.'), p(20, 21, 'Where were you?')], 'rollup');
		expect(second!.previous).toBeUndefined();
	});

	test('never more than two lines; in order, though Whisper gave them out of it', () => {
		const burst = formCues([p(5.4, 6, 'Hi!'), p(5, 5.2, 'Oh.'), p(5.2, 5.4, 'Hey.')], 'rollup');
		expect(lines(burst)).toEqual(['Oh.', 'Oh.\nHey.', 'Hey.\nHi!']);
		expect(burst.every((c) => c.end > c.start)).toBe(true);
	});
});

describe('formCues: in blocks', () => {
	const talk = [
		p(103, 104, 'Has she slept at all?'),
		p(104.4, 105, 'Nope.'),
		p(105, 107, "No, it's been three nights in a row."),
		p(107.2, 109, 'Yeah, she finally stopped crying yesterday,')
	];

	test('the first alone, then the second under it: lines that do not move', () => {
		expect(lines(formCues(talk, 'blocks'))).toEqual([
			'Has she slept at all?',
			'Has she slept at all?\nNope.',
			"No, it's been three nights in a row.",
			"No, it's been three nights in a row.\nYeah, she finally stopped crying yesterday,"
		]);
	});

	test('a block goes when the next starts; the last, once read', () => {
		const cues = formCues(talk, 'blocks');
		expect(cues.map((c) => [c.start, c.end])).toEqual([
			[103, 104.4],
			[104.4, 105],
			[105, 107.2],
			[107.2, 110.067]
		]);
	});

	test('after a pause, a block of its own', () => {
		expect(lines(formCues([p(10, 11, 'Hi.'), p(20, 21, 'Where were you?')], 'blocks'))).toEqual([
			'Hi.',
			'Where were you?'
		]);
	});
});

describe('formCues: one line', () => {
	test('each alone, until the next; the last, once read', () => {
		const cues = formCues([p(103, 104, 'Has she slept at all?'), p(104.4, 105, 'Nope.')], 'single');
		expect(cues).toEqual([
			{ start: 103, end: 104.4, text: 'Has she slept at all?' },
			{ start: 104.4, end: 105.9, text: 'Nope.' }
		]);
	});
});

describe('phrasesFromVtt: from subtitles made before the phrases were kept', () => {
	test("rolled up: each cue's last line, when it starts", () => {
		const vtt = formCues([p(1, 2, 'A.'), p(2.5, 3, 'B.'), p(3.2, 4, 'C.')], 'rollup').map((c) => ({
			...c,
			text: lines([c])[0]!,
			previous: undefined
		}));
		expect(phrasesFromVtt(vtt).map((c) => [c.start, c.text])).toEqual([
			[1, 'A.'],
			[2.5, 'B.'],
			[3.2, 'C.']
		]);
	});

	test('two lines joined (not rolled up): two phrases, the second from halfway', () => {
		expect(phrasesFromVtt([p(7.69, 10, '$6?\nI just had it.')])).toEqual([
			{ start: 7.69, end: 8.845, text: '$6?' },
			{ start: 8.845, end: 10, text: 'I just had it.' }
		]);
	});

	test('one line: the phrase as it was', () => {
		expect(phrasesFromVtt([p(1, 2, 'Hi.')])).toEqual([p(1, 2, 'Hi.')]);
	});
});

test('rolled up and dimmed: the line before in a class the page dims', () => {
	const [, second] = formCues([p(1, 2, 'A.'), p(2.5, 3, 'B.')], 'rollupDim');
	expect(serializeVtt([second!], { dim: true })).toContain('<c.prev>A.</c>\nB.');
	expect(serializeVtt([second!])).toContain('A.\nB.');
});
