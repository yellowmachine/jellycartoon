import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteSample,
	KINDS,
	maxBytes,
	saveSample,
	type Kind
} from '#lib/server/wakeword-samples.ts';

const kindOf = (url: URL) => {
	const kind = url.searchParams.get('tipo') as Kind;
	if (!KINDS.includes(kind)) error(400, 'Tipo de grabación no válido');
	return kind;
};

/**
 * A take of the wake word (#144): the WAV as the body; `tipo` (one of `KINDS`) and `quien` (who
 * speaks, or what sounds for «fondo») in the address.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const kind = kindOf(url);
	if (Number(request.headers.get('content-length')) > maxBytes(kind))
		error(413, 'Demasiado grande');
	const wav = new Uint8Array(await request.arrayBuffer());
	try {
		const name = await saveSample(kind, url.searchParams.get('quien') ?? '', wav, locals.user!.id);
		return json({ name });
	} catch (err) {
		error(400, err instanceof Error ? err.message : 'No se pudo guardar');
	}
};

/** Undo a take: the same `tipo` and `quien`, and `nombre`, as POST gave it. */
export const DELETE: RequestHandler = async ({ url }) => {
	const kind = kindOf(url);
	try {
		await deleteSample(
			kind,
			url.searchParams.get('quien') ?? '',
			url.searchParams.get('nombre') ?? ''
		);
		return new Response(null, { status: 204 });
	} catch (err) {
		error(400, err instanceof Error ? err.message : 'No se pudo borrar');
	}
};
