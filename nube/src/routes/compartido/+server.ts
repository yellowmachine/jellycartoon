import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Where «Compartir → Nube» lands (the manifest's share_target): a link (a recipe's page) goes to
 * Recetas, waiting in its box; a file, through the service worker, to Gastos. From Android the
 * shared address comes inside `text`, not in `url`.
 */
export const GET: RequestHandler = async ({ url }) => {
	const shared = ['url', 'text', 'title']
		.map((key) => url.searchParams.get(key)?.match(/https?:\/\/\S+/)?.[0] ?? null)
		.find(Boolean);
	redirect(303, shared ? `/recetas?url=${encodeURIComponent(shared)}` : '/');
};

/**
 * The share_target is a POST, for files; the service worker takes it. Without one yet (the app
 * opened for the first time), here: a link or a text, to the GET; a file cannot reach the page from
 * here, so Gastos says to share it again.
 */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const file = form?.get('archivo');
	if (file instanceof File && file.size) redirect(303, '/gastos?compartido=archivo');
	const params = new URLSearchParams();
	for (const key of ['title', 'text', 'url']) {
		const value = form?.get(key);
		if (typeof value === 'string' && value) params.set(key, value);
	}
	redirect(303, `/compartido?${params}`);
};
