import { describe, expect, test } from 'bun:test';
import { withoutMetadata } from './no-exif.ts';

const segment = (marker: number, body: number[]) => [0xff, marker, 0, body.length + 2, ...body];
const GPS = [0x45, 0x78, 0x69, 0x66, 0, 0, 0x47, 0x50, 0x53];

describe('a shared photo without what the camera wrote (#434)', () => {
	test('JPEG: EXIF and IPTC out, the rest as it is', () => {
		const jpeg = new Uint8Array([
			0xff,
			0xd8,
			...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]),
			...segment(0xe1, GPS),
			...segment(0xed, [1, 2, 3]),
			...segment(0xdb, [9, 9]),
			0xff,
			0xda,
			0,
			4,
			7,
			7,
			0xff,
			0xd9
		]);
		const clean = withoutMetadata(jpeg)!;
		expect(clean.type).toBe('image/jpeg');
		expect([...clean.bytes]).toEqual([
			0xff,
			0xd8,
			...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]),
			...segment(0xdb, [9, 9]),
			0xff,
			0xda,
			0,
			4,
			7,
			7,
			0xff,
			0xd9
		]);
	});

	test('PNG: eXIf and text chunks out', () => {
		const chunk = (type: string, body: number[]) => [
			0,
			0,
			0,
			body.length,
			...[...type].map((c) => c.charCodeAt(0)),
			...body,
			1,
			2,
			3,
			4
		];
		const head = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
		const png = new Uint8Array([
			...head,
			...chunk('IHDR', [5, 5]),
			...chunk('eXIf', GPS),
			...chunk('iTXt', [1]),
			...chunk('IDAT', [8]),
			...chunk('IEND', [])
		]);
		const clean = withoutMetadata(png)!;
		expect(clean.type).toBe('image/png');
		expect([...clean.bytes]).toEqual([
			...head,
			...chunk('IHDR', [5, 5]),
			...chunk('IDAT', [8]),
			...chunk('IEND', [])
		]);
	});

	test('broken or of another kind: not shared', () => {
		expect(withoutMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 99, 1]))).toBeNull();
		expect(withoutMetadata(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull();
	});
});
