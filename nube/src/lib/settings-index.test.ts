import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { SETTINGS_INDEX, searchSettings } from './settings-index.ts';

/** Ajustes' page, its sections' components, and those shared with the house (packages/comun). */
const dir = new URL('../routes/ajustes/', import.meta.url);
const page = [
	...readdirSync(dir)
		.filter((f) => f.endsWith('.svelte'))
		.map((f) => readFileSync(new URL(f, dir), 'utf8')),
	readFileSync(
		new URL('../../../packages/comun/src/components/Colores.svelte', import.meta.url),
		'utf8'
	)
].join('\n');

test('every section of the index is on the page, once', () => {
	for (const entry of SETTINGS_INDEX) {
		const found = page.match(new RegExp(`\\bid="${entry.id}"`, 'g')) ?? [];
		expect({ id: entry.id, times: found.length }).toEqual({ id: entry.id, times: 1 });
	}
});

test('found by a word, the administrator’s only for them', () => {
	expect(searchSettings('modo oscuro', { admin: false }).map((e) => e.id)).toEqual(['colores']);
	expect(searchSettings('notificaciones', { admin: false }).map((e) => e.id)).toEqual(['avisos']);
	expect(searchSettings('silencio', { admin: true }).map((e) => e.id)).toEqual(['voz-silencio']);
	expect(searchSettings('silencio', { admin: false })).toEqual([]);
});
