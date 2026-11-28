import { expect, test } from 'bun:test';
import { audioKind, audioTypeOf, notesTabOf, onlyLink } from '#lib/notes.ts';

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

test('Notas’ tab by its address; the old «Para leer», Textos with only the webs', () => {
	const tab = (q: string) => notesTabOf(new URLSearchParams(q));
	expect(tab('')).toEqual({ kind: 'voz', only: null });
	expect(tab('foto')).toEqual({ kind: 'foto', only: null });
	expect(tab('texto')).toEqual({ kind: 'texto', only: null });
	expect(tab('texto&solo=notas')).toEqual({ kind: 'texto', only: 'notas' });
	expect(tab('leer')).toEqual({ kind: 'texto', only: 'leer' });
	// «solo» is only Textos'; and nothing else.
	expect(tab('foto&solo=leer')).toEqual({ kind: 'foto', only: null });
	expect(tab('texto&solo=todo')).toEqual({ kind: 'texto', only: null });
});

test('only a web’s address is saved to read; a note with one in it, a note', () => {
	expect(onlyLink('  https://pan.es/masa-madre \n')).toBe('https://pan.es/masa-madre');
	expect(onlyLink('HTTP://pan.es')).toBe('HTTP://pan.es');
	expect(onlyLink('Mira esto: https://pan.es')).toBeNull();
	expect(onlyLink('https://pan.es otra cosa')).toBeNull();
	expect(onlyLink('pan.es')).toBeNull();
	expect(onlyLink('')).toBeNull();
});
