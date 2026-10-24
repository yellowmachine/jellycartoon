import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteSample,
	KINDS,
	MAX_SAMPLE_BYTES,
	saveSample,
	type Kind
} from '#lib/server/wakeword-samples.ts';

const kindOf = (url: URL) => {
	const kind = url.searchParams.get('tipo') as Kind;
	if (!KINDS.includes(kind)) error(400, 'Tipo de grabación no válido');
	return kind;
};

/**
 * A take of the wake word (#144): the WAV as the body; `tipo` (candy_candy or parecidas) and
 * `quien` (who speaks) in the address.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	if (Number(request.headers.get('content-length')) > MAX_SAMPLE_BYTES)
		error(413, 'Demasiado grande');
	const kind = kindOf(url);
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
