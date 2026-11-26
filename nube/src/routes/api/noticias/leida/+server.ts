import { error, type RequestHandler } from '@sveltejs/kit';
import { news } from '#lib/server/news.ts';
import { isItemId } from '#lib/server/greader.ts';

/** One of the home page's news, opened: as read in their reader (#428, #638). */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401);
	const { id } = (await request.json().catch(() => ({}))) as { id?: unknown };
	if (!isItemId(id)) error(400, 'Noticia no válida');
	await news.markRead(locals.user.id, id);
	return new Response(null, { status: 204 });
};
