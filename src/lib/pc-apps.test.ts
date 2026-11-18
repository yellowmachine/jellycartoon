import { expect, test } from 'bun:test';
import { isAppId, parseAppList } from './pc-apps.ts';

/** The PC's apps (#530) as the service lists them (`flatpak list --app --columns=application,name`). */
test('the list: each app with its name, by name; anything else left out', () => {
	expect(
		parseAppList(
			'org.chromium.Chromium\tChromium\ncom.ktechpit.red\tRed\nnet.retrodeck.retrodeck\t\n\nbasura\tX\n'
		)
	).toEqual([
		{ id: 'org.chromium.Chromium', name: 'Chromium' },
		{ id: 'net.retrodeck.retrodeck', name: 'net.retrodeck.retrodeck' },
		{ id: 'com.ktechpit.red', name: 'Red' }
	]);
});

test('only an id as Flatpak names them', () => {
	expect(isAppId('com.ktechpit.red')).toBe(true);
	expect(isAppId('org.kde.Platform')).toBe(true);
	for (const bad of ['red', 'com.red', '-x.y.z', 'a.b.c d', 'a.b.c;ls', '../a.b.c', 'a.b.c/x'])
		expect(isAppId(bad)).toBe(false);
});
