import { expect, test } from 'bun:test';
import { concatInput } from './concat-input.ts';

test('an fMP4 HLS playlist, as one file: its init first, then its segments', () => {
	const playlist = [
		'#EXTM3U',
		'#EXT-X-VERSION:7',
		'#EXT-X-MAP:URI="init_1.mp4"',
		'#EXTINF:6.013968,',
		'seg_00000.m4s',
		'#EXTINF:5.990748,',
		'seg_00001.m4s\r',
		'#EXT-X-ENDLIST',
		''
	].join('\n');
	expect(concatInput('/data/hls/7/a0', playlist)).toBe(
		'lavf://concat:/data/hls/7/a0/init_1.mp4|/data/hls/7/a0/seg_00000.m4s|/data/hls/7/a0/seg_00001.m4s'
	);
});
