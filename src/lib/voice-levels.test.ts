import { expect, test } from 'bun:test';
import { MUSIC_DUCK, parseVoiceLevels, piperStyle, VOICE_GAIN } from './voice-levels.ts';

test('voice levels within their ranges, the default for what is missing', () => {
	const piper = { expressiveness: 120, speed: 95, aiAnswers: false };
	expect(parseVoiceLevels(null)).toEqual({
		gainDb: VOICE_GAIN.default,
		duckDb: MUSIC_DUCK.default,
		...piper
	});
	expect(parseVoiceLevels({ gainDb: '6', duckDb: -50 })).toEqual({
		gainDb: 6,
		duckDb: -30,
		...piper
	});
	expect(parseVoiceLevels({ gainDb: 'mucho', duckDb: '' })).toEqual({
		gainDb: 0,
		duckDb: -12,
		...piper
	});
	expect(parseVoiceLevels({ expressiveness: 300, speed: '90', aiAnswers: 'on' })).toMatchObject({
		expressiveness: 150,
		speed: 90,
		aiAnswers: true
	});
});

test("Piper's own way at 100 %, its parameters otherwise", () => {
	expect(piperStyle({ expressiveness: 100, speed: 100 })).toEqual({});
	expect(piperStyle({ expressiveness: 150, speed: 80 })).toEqual({
		noise_scale: 1.001,
		noise_w_scale: 1.2,
		length_scale: 1.25
	});
});
