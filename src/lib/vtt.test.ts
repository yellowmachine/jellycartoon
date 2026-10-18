import { describe, expect, test } from 'bun:test';
import { cuesBetween, cuesText, parseVtt, serializeVtt } from './vtt.ts';

const VTT = `WEBVTT

NOTE a comment --> not a cue

STYLE
::cue { color: yellow }

1
00:00:01.000 --> 00:00:03.500 align:start
<i>Hello</i> &amp; welcome

00:04.000 --> 00:06.000
Two lines
of text

01:00:00,000 --> 01:00:02,000
An hour in

00:00:07.000 --> 00:00:08.000
`;

describe('parseVtt', () => {
	test('cues with their times, tags and entities out; empty and non-cues skipped', () => {
		expect(parseVtt(VTT)).toEqual([
			{ start: 1, end: 3.5, text: 'Hello & welcome' },
			{ start: 4, end: 6, text: 'Two lines\nof text' },
			{ start: 3600, end: 3602, text: 'An hour in' }
		]);
	});

	test('Windows line ends', () => {
		expect(parseVtt('WEBVTT\r\n\r\n00:01.000 --> 00:02.000\r\nHi\r\n')).toEqual([
			{ start: 1, end: 2, text: 'Hi' }
		]);
	});
});

describe('cuesBetween', () => {
	const cues = parseVtt(VTT);

	test('those in the stretch, half-in ones too, timed from its start', () => {
		expect(cuesBetween(cues, 3, 5)).toEqual([
			{ start: 0, end: 0.5, text: 'Hello & welcome' },
			{ start: 1, end: 3, text: 'Two lines\nof text' }
		]);
	});

	test('none outside it', () => {
		expect(cuesBetween(cues, 10, 20)).toEqual([]);
	});
});

test('cuesText: one line per cue, repeats once', () => {
	expect(
		cuesText([
			{ start: 0, end: 1, text: 'Two lines\nof text' },
			{ start: 1, end: 2, text: 'Two lines\nof text' },
			{ start: 2, end: 3, text: 'Bye' }
		])
	).toBe('Two lines of text\nBye');
});

describe('serializeVtt', () => {
	test('times and escaped text, read back the same', () => {
		const cues = [
			{ start: 1.5, end: 3.25, text: 'Tom & Jerry <3' },
			{ start: 3725.5, end: 3727, text: 'Two\nlines' }
		];
		const vtt = serializeVtt(cues);
		expect(vtt).toBe(
			'WEBVTT\n\n00:00:01.500 --> 00:00:03.250\nTom &amp; Jerry &lt;3\n\n01:02:05.500 --> 01:02:07.000\nTwo\nlines\n'
		);
		expect(parseVtt(vtt)).toEqual(cues);
	});
});
