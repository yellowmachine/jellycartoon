import { describe, expect, test } from 'bun:test';
import { rejectMalformedPath } from './malformed-path.ts';

/** A path SvelteKit cannot decode, refused before any `handle` can throw (sveltejs/kit#17193). */
const run = (path: string) =>
	rejectMalformedPath({
		event: { url: new URL(`http://casa${path}`) } as never,
		resolve: async () => new Response('ok')
	}) as Promise<Response>;

describe('rejectMalformedPath', () => {
	test('undecodable paths, a 400; the rest go on', async () => {
		for (const bad of ['/%C0', '/%E0%A4%A', '/api/%C0', '/s/%25%C0'])
			expect((await run(bad)).status).toBe(400);
		for (const good of ['/', '/login', '/caf%C3%A9', '/s/100%25'])
			expect(await (await run(good)).text()).toBe('ok');
	});
});
