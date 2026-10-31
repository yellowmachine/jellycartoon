import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAdmin } from '#lib/server/app-settings.ts';
import { isKid } from '#lib/server/kids.ts';
import { candidates } from '#lib/server/tv-shortcut-targets.ts';
import { isShortcutKind } from '#lib/tv-shortcut-kinds.ts';

/**
 * What a TV shortcut of a kind can open (#343), for Ajustes → Casa → Accesos directos to choose
 * from: `?tipo=serie`… Only for who manages the app, as the shortcuts are.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user || isKid(locals.user) || !(await isAdmin(locals.user.id)))
		error(404, 'No encontrado');
	const kind = url.searchParams.get('tipo') ?? '';
	if (!isShortcutKind(kind) || kind === 'url') error(400, 'Tipo no válido');
	return json(await candidates(kind, locals.user.id));
};
