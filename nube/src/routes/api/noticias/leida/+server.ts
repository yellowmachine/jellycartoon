import { error, type RequestHandler } from '@sveltejs/kit';
import { news } from '#lib/server/news.ts';

/** One of the home page's news, opened: as read in their Miniflux (#428). */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401);
	const { id } = (await request.json().catch(() => ({}))) as { id?: unknown };
	if (!Number.isSafeInteger(id) || (id as number) <= 0) error(400, 'Noticia no válida');
	await news.markRead(locals.user.id, id as number);
	return new Response(null, { status: 204 });
};
