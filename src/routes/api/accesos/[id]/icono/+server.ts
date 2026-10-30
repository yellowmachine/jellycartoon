import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import type { RequestHandler } from './$types';
import { isKid } from '#lib/server/kids.ts';
import { openableShortcut } from '#lib/server/tv-shortcuts.ts';
import { iconFile } from '#lib/server/tv-shortcut-icons.ts';

const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

/**
 * A TV shortcut's icon (#327), kept at home: a child, only a children's one's. Its address carries
 * the file's name, new with each icon, so it is cached for good.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const shortcut = await openableShortcut(Number(params.id), isKid(locals.user));
	const file = shortcut?.icon && iconFile(shortcut.icon);
	if (!file) error(404, 'Not found');
	const bytes = await readFile(file).catch(() => null);
	if (!bytes) error(404, 'Not found');
	const kind = shortcut!.icon!.split('.').pop() as keyof typeof TYPES;
	return new Response(bytes, {
		headers: {
			'content-type': TYPES[kind],
			'cache-control': 'private, max-age=31536000, immutable',
			'x-content-type-options': 'nosniff'
		}
	});
};
