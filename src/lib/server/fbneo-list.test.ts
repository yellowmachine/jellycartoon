import { describe, expect, it, mock } from 'bun:test';

mock.module('#lib/server/library/paths.ts', () => ({ dataRoot: '/tmp' }));
const { biosOf, parse } = await import('./fbneo.ts');

const xml = `
	<game name="sf2" sourcefile="capcom/d_cps1.cpp">
		<description>Street Fighter II: The World Warrior (World 910522)</description>
	</game>
	<game isbios="yes" name="neogeo" sourcefile="neogeo/d_neogeo.cpp">
		<comment>BIOS only</comment>
		<description>Neo Geo</description>
	</game>
	<game name="mslug" romof="neogeo" sourcefile="neogeo/d_neogeo.cpp">
		<description>Metal Slug - Super Vehicle-001</description>
	</game>
	<game name="mslugx" cloneof="mslug" romof="mslug" sourcefile="neogeo/d_neogeo.cpp">
		<description>Metal Slug X &amp; Co</description>
	</game>`;

describe('FBNeo list', () => {
	const games = parse(xml);

	it('reads every game, also those with a comment first', () => {
		expect(Object.keys(games)).toEqual(['sf2', 'neogeo', 'mslug', 'mslugx']);
		expect(games.neogeo).toEqual({ description: 'Neo Geo', isBios: true });
		expect(games.mslugx.description).toBe('Metal Slug X & Co');
	});

	it('finds the BIOS through the clones', () => {
		expect(biosOf(games, 'mslug')).toBe('neogeo');
		expect(biosOf(games, 'mslugx')).toBe('neogeo');
		expect(biosOf(games, 'sf2')).toBeNull();
	});
});
