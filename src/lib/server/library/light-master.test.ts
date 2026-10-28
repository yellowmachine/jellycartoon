import { describe, expect, test } from 'bun:test';
import { LIGHT_DIR, onlyLight, segmentsOf, withLight, withoutLight } from './light-master.ts';

const MASTER = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="group_aud",NAME="audio_1",DEFAULT=YES,LANGUAGE="eng",CHANNELS="2",URI="a0/index.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=23716731,AVERAGE-BANDWIDTH=15003659,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="group_aud"
video/index.m3u8
`;

const LIGHT = { bandwidth: 3_100_000.4, averageBandwidth: 2_000_000, width: 1280, height: 720 };

describe('the light variant in the master playlist', () => {
	test('after the original, with its audio group and audio codec', () => {
		expect(withLight(MASTER, LIGHT)).toBe(
			`${MASTER}#EXT-X-STREAM-INF:BANDWIDTH=3100000,AVERAGE-BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2",AUDIO="group_aud"\n${LIGHT_DIR}/index.m3u8\n`
		);
	});

	test('made again, only once', () => {
		const twice = withLight(withLight(MASTER, LIGHT), { ...LIGHT, bandwidth: 2_900_000 });
		expect(twice.match(/video-720/g)).toHaveLength(1);
		expect(twice).toContain('BANDWIDTH=2900000,');
	});

	test('taken out, as converted', () => {
		expect(withoutLight(withLight(MASTER, LIGHT)).trimEnd()).toBe(MASTER.trimEnd());
	});

	test('alone, without the original', () => {
		const light = onlyLight(withLight(MASTER, LIGHT));
		expect(light).not.toContain('video/index.m3u8');
		expect(light).toContain('RESOLUTION=1280x720');
		expect(light).toContain('a0/index.m3u8');
	});

	test('alone, or the original if there is none', () => {
		expect(onlyLight(MASTER)).toBe(MASTER);
	});

	test('without audio, without an audio group', () => {
		const silent = MASTER.replace(',mp4a.40.2', '').replace(',AUDIO="group_aud"', '');
		expect(withLight(silent, LIGHT)).toContain('CODECS="avc1.640028"\nvideo-720');
	});
});

test('the segments of a media playlist', () => {
	const playlist = [
		'#EXTM3U',
		'#EXT-X-MAP:URI="init.mp4"',
		'#EXTINF:6.006,',
		'seg_00000.m4s',
		'#EXTINF:4.5,',
		'seg_00001.m4s',
		'#EXT-X-ENDLIST'
	].join('\n');
	expect(segmentsOf(playlist)).toEqual([
		{ seconds: 6.006, file: 'seg_00000.m4s' },
		{ seconds: 4.5, file: 'seg_00001.m4s' }
	]);
});
