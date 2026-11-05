import { expect, test } from 'bun:test';
import { audioKind, audioTypeOf } from '#lib/notes.ts';

test('a recording, by its first bytes', () => {
	expect(audioKind(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1]))?.ext).toBe('webm');
	expect(audioKind(new TextEncoder().encode('OggS....'))?.ext).toBe('ogg');
	expect(audioKind(new TextEncoder().encode('\0\0\0\x18ftypM4A '))?.ext).toBe('m4a');
	expect(audioKind(new TextEncoder().encode('<script>'))).toBeNull();
	expect(audioKind(new Uint8Array())).toBeNull();
});

test('served by its name', () => {
	expect(audioTypeOf('a.webm')).toBe('audio/webm');
	expect(audioTypeOf('a.m4a')).toBe('audio/mp4');
	expect(audioTypeOf('a.html')).toBeNull();
});
