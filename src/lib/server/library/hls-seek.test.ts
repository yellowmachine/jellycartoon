import { expect, test } from 'bun:test';
import { segmentsFrom } from './hls-seek.ts';

const PLAYLIST = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="init_0.mp4"
#EXTINF:9.920000,
seg_00000.m4s
#EXTINF:4.960000,
seg_00001.m4s
#EXTINF:4.960000,
seg_00002.m4s
#EXT-X-ENDLIST
`;

test('segmentsFrom: the segment with that second, the rest, and how far into it', () => {
	expect(segmentsFrom(PLAYLIST, 0)).toEqual({
		map: 'init_0.mp4',
		segments: ['seg_00000.m4s', 'seg_00001.m4s', 'seg_00002.m4s'],
		offsetSec: 0
	});
	const middle = segmentsFrom(PLAYLIST, 12)!;
	expect(middle.segments).toEqual(['seg_00001.m4s', 'seg_00002.m4s']);
	expect(middle.offsetSec).toBeCloseTo(2.08);
	// Past the end: the last one.
	expect(segmentsFrom(PLAYLIST, 999)!.segments).toEqual(['seg_00002.m4s']);
});

test('segmentsFrom: not one of ours', () => {
	expect(segmentsFrom('#EXTM3U\n#EXTINF:5,\nseg.ts\n', 0)).toBeNull();
	expect(segmentsFrom('', 0)).toBeNull();
});
