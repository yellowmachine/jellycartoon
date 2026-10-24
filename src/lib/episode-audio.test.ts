import { expect, test } from 'bun:test';
import { audioTrackFor, episodeAudioUrl, resumeFrom } from './episode-audio.ts';

const tracks = [
	{ lang: 'spa', label: 'Español' },
	{ lang: 'eng', label: 'English' },
	{ lang: 'ger', label: 'Deutsch' }
];

test('the track in the language chosen, or else the first', () => {
	expect(audioTrackFor(tracks, 'eng')).toBe(1);
	expect(audioTrackFor(tracks, 'en')).toBe(1);
	expect(audioTrackFor(tracks, 'fra')).toBe(0);
	expect(audioTrackFor(tracks, null)).toBe(0);
	expect(audioTrackFor([], 'eng')).toBe(0);
});

test('its HLS audio track, as ffmpeg leaves it beside the video', () => {
	expect(episodeAudioUrl(1582, 1)).toBe('/api/hls/1582/a1/index.m3u8');
});

test('from where it was, past the first seconds and not once watched', () => {
	expect(resumeFrom(754, false)).toBe(754);
	expect(resumeFrom(3, false)).toBe(0);
	expect(resumeFrom(754, true)).toBe(0);
	expect(resumeFrom(null, null)).toBe(0);
});
