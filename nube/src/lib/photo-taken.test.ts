import { expect, test } from 'bun:test';
import { photoTaken } from './photo-taken.ts';

/** A JPEG with an EXIF block: its date, time zone and place. */
function jpeg(little: boolean) {
	const tiff = new DataView(new ArrayBuffer(300));
	const u16 = (o: number, v: number) => tiff.setUint16(o, v, little);
	const u32 = (o: number, v: number) => tiff.setUint32(o, v, little);
	const text = (o: number, s: string) =>
		[...s].forEach((c, i) => tiff.setUint8(o + i, c.charCodeAt(0)));
	const entry = (o: number, tag: number, type: number, count: number, value: number | string) => {
		u16(o, tag);
		u16(o + 2, type);
		u32(o + 4, count);
		if (typeof value === 'string') text(o + 8, value);
		else u32(o + 8, value);
	};
	u16(0, little ? 0x4949 : 0x4d4d);
	u16(2, 42);
	u32(4, 8);
	u16(8, 2);
	entry(10, 0x8769, 4, 1, 40);
	entry(22, 0x8825, 4, 1, 80);
	u16(40, 2);
	entry(42, 0x9003, 2, 20, 150);
	entry(54, 0x9011, 2, 7, 172);
	u16(80, 4);
	entry(82, 1, 2, 2, 'N');
	entry(94, 2, 5, 3, 180);
	entry(106, 3, 2, 2, 'W');
	entry(118, 4, 5, 3, 210);
	text(150, '2026:11-'.replace('-', ':') + '25 12:30:00');
	text(172, '+01:00');
	[
		[180, 37, 1],
		[188, 30, 1],
		[196, 0, 1],
		[210, 1, 1],
		[218, 6, 1],
		[226, 3600, 100]
	].forEach(([o, a, b]) => (u32(o!, a!), u32(o! + 4, b!)));
	const head = [0xff, 0xd8, 0xff, 0xe1, 0x01, 0x34, 0x45, 0x78, 0x69, 0x66, 0, 0];
	const out = new Uint8Array(head.length + 300);
	out.set(head);
	out.set(new Uint8Array(tiff.buffer), head.length);
	return out.buffer;
}

test('when and where, in either byte order', () => {
	for (const little of [true, false]) {
		const { at, position } = photoTaken(jpeg(little));
		expect(at?.toISOString()).toBe('2026-11-25T11:30:00.000Z');
		expect(position![0]).toBeCloseTo(-1.11, 5);
		expect(position![1]).toBeCloseTo(37.5, 5);
	}
});

test('nothing written, not a JPEG or cut short: null', () => {
	const nothing = { at: null, position: null };
	expect(photoTaken(new Uint8Array([0xff, 0xd8, 0xff, 0xda]).buffer)).toEqual(nothing);
	expect(photoTaken(new Uint8Array([1, 2]).buffer)).toEqual(nothing);
	expect(photoTaken(jpeg(true).slice(0, 60))).toEqual(nothing);
});
