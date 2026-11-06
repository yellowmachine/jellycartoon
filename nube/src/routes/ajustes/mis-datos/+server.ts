import { error } from '@sveltejs/kit';
import { makeZip } from 'client-zip';
import type { RequestHandler } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { myDataFiles, readMyData } from '#lib/server/my-data.ts';

/** «Descargar mis datos» (#315): an adult's, as a zip (my-data.ts). A child's are its adults'. */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.user!.id;
	const role = await withFamily(userId, async (_, m) => m.role);
	if (role === 'peque') error(403, 'Solo para adultos');
	const k = await kitchenOf(userId);
	const data = await readMyData(k, userId);
	return new Response(makeZip(myDataFiles(k, data)), {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="seilide-mis-datos-${data.day}.zip"`,
			'Cache-Control': 'private, no-store'
		}
	});
};
