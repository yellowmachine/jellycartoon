import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { SETTINGS_INDEX, searchSettings, type SettingsShown } from './settings-index.ts';

/** Ajustes' page and its sections' components (#178), all together. */
const dir = new URL('../routes/ajustes/', import.meta.url);
const page = readdirSync(dir)
	.filter((f) => f.endsWith('.svelte'))
	.map((f) => readFileSync(new URL(f, dir), 'utf8'))
	.join('\n');

/** An adult who manages the app, with everything on. */
const admin: SettingsShown = {
	kid: false,
	intro: true,
	keepHistory: false,
	recordTrips: false,
	langua: {},
	telegram: {},
	telegramBot: {},
	houseStyle: {},
	myStyle: {},
	voiceWeb: {},
	musicApps: {},
	voice: true,
	music: true,
	ai: {},
	spendLine: false,
	labels: {},
	routes: {},
	relay: {},
	satellites: [],
	home: {},
	houseVoice: {},
	kids: {},
	twoFactor: {}
};
/** A child: none of the house's, nor their history. */
const kid: SettingsShown = {
	...admin,
	kid: true,
	keepHistory: null,
	recordTrips: null,
	langua: null,
	voice: false,
	ai: null,
	spendLine: null,
	labels: null,
	routes: null,
	relay: null,
	satellites: null,
	home: null,
	houseVoice: null,
	kids: null
};

test('every section of the index is on the page, once', () => {
	for (const entry of SETTINGS_INDEX) {
		const found = page.match(new RegExp(`\\bid="${entry.id}"`, 'g')) ?? [];
		expect({ id: entry.id, times: found.length }).toEqual({ id: entry.id, times: 1 });
	}
	expect(new Set(SETTINGS_INDEX.map((e) => e.id)).size).toBe(SETTINGS_INDEX.length);
});

test('by words it does not say, accents and case aside', () => {
	expect(searchSettings('niños', admin).map((e) => e.id)).toContain('personas');
	expect(searchSettings('IA', admin)[0]?.id).toBe('ia');
	expect(searchSettings('subtitulos', admin).map((e) => e.id)).toEqual([
		'estilo-subtitulos',
		'reproduccion'
	]);
	expect(searchSettings('modo oscuro', admin).map((e) => e.id)).toEqual(['colores']);
	expect(searchSettings('nombre movil', admin).map((e) => e.id)).toEqual(['este-dispositivo']);
});

test('only what the page shows to whoever looks', () => {
	expect(searchSettings('clave', kid)).toEqual([]);
	expect(searchSettings('historial', kid)).toEqual([]);
	expect(searchSettings('colores', kid).map((e) => e.id)).toEqual(['colores']);
});

test('nothing typed, nothing; nothing found, nothing', () => {
	expect(searchSettings('  ', admin)).toEqual([]);
	expect(searchSettings('zzz', admin)).toEqual([]);
});
