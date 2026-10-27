import { expect, test } from 'bun:test';
import { MUSIC_DUCK, parseVoiceLevels, VOICE_GAIN } from './voice-levels.ts';

test('voice levels within their ranges, the default for what is missing', () => {
	expect(parseVoiceLevels(null)).toEqual({
		gainDb: VOICE_GAIN.default,
		duckDb: MUSIC_DUCK.default
	});
	expect(parseVoiceLevels({ gainDb: '6', duckDb: -50 })).toEqual({ gainDb: 6, duckDb: -30 });
	expect(parseVoiceLevels({ gainDb: 'mucho', duckDb: '' })).toEqual({ gainDb: 0, duckDb: -12 });
});
