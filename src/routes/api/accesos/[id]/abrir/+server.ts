import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isKid } from '#lib/server/kids.ts';
import { log } from '#lib/server/log.ts';
import { openPcApp, pcAppsEnabled } from '#lib/server/pc-apps.ts';
import { openableShortcut } from '#lib/server/tv-shortcuts.ts';

/**
 * A TV shortcut to an app of the PC (#530), from the TV view: opened there, over the TV view (the
 * remote's power button goes back). Adults only, as Steam: not in kids.ts, and a child's tiles
 * never have it.
 */
export const POST: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(400, 'Bad request');
	const shortcut = await openableShortcut(id, isKid(locals.user));
	if (shortcut?.kind !== 'app' || !shortcut.target) error(404, 'Not found');
	if (!(await pcAppsEnabled()))
		error(503, 'El PC del salón no abre aplicaciones: falta su servicio (scripts/pantalla.sh)');
	try {
		await openPcApp(shortcut.target);
	} catch (problem) {
		log.warn('accesos', 'No se pudo abrir la aplicación', {
			app: shortcut.target,
			error: problem
		});
		error(503, problem instanceof Error ? problem.message : 'No se pudo abrir');
	}
	log.info('accesos', 'Aplicación abierta', { app: shortcut.target });
	return new Response(null, { status: 204 });
};
