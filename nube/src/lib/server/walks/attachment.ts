import { isLngLat } from 'comun/road.ts';

/**
 * What a device sends of what it kept during a walk (#416), or of a note recorded anywhere: when and
 * where, as it happened, however late it arrives. A walk is known by when it started.
 */
export async function sentAttachment(
	request: Request,
	maxBytes: number
): Promise<
	| { problem: string; status: 400 | 413 }
	| {
			clientId: string;
			at: Date;
			lon: number | null;
			lat: number | null;
			startedAt: Date | null;
			file: Uint8Array;
	  }
> {
	const form = await request.formData().catch(() => null);
	const file = form?.get('fichero');
	const clientId = form?.get('id');
	const at = Number(form?.get('at'));
	if (
		!(file instanceof File) ||
		!file.size ||
		typeof clientId !== 'string' ||
		!/^[\w-]{8,64}$/.test(clientId) ||
		!Number.isFinite(at) ||
		at <= 0
	)
		return { problem: 'No se entiende lo enviado', status: 400 };
	if (file.size > maxBytes) return { problem: 'Es demasiado grande', status: 413 };
	const position = [Number(form?.get('lon')), Number(form?.get('lat'))];
	const placed = form?.has('lon') && isLngLat(position);
	const started = Number(form?.get('paseo'));
	return {
		clientId,
		at: new Date(at),
		lon: placed ? position[0]! : null,
		lat: placed ? position[1]! : null,
		startedAt: started > 0 ? new Date(started) : null,
		file: new Uint8Array(await file.arrayBuffer())
	};
}
