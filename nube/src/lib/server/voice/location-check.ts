/**
 * «Manda mi ubicación a mamá» by voice (#550): never sent on the first order, which may have been
 * heard wrong, but on its answer. As the «horas de silencio» (quiet-check.ts): the first order only
 * asks; a later one, within `ANSWER_MS`, for the same person and the same kind, is its «sí».
 */

/** After the question, how long its «sí» may take. */
const ANSWER_MS = 2 * 60_000;

/** By family and person: what was asked, by which order. */
const asked = new Map<string, { order: string; what: string; at: number }>();

/**
 * Null, it may be sent now (the answer to the question); else what to tell the model. `what`: to
 * whom and how («id:live»), so a «sí» does not send something else.
 */
export function locationCheck(
	key: string,
	order: string,
	what: string,
	question: string,
	now = Date.now()
): string | null {
	const last = asked.get(key);
	if (last && last.what === what && last.order !== order && now - last.at < ANSWER_MS) {
		asked.delete(key);
		return null;
	}
	asked.set(key, { order, what, at: now });
	return `No se ha mandado todavía, por si se ha oído mal. Pregúntale con «ask» «${question}», con las opciones «Sí» (la orden completa repetida con un sí delante: «Sí, manda mi ubicación a …») y «No» (orden «No»). No hagas nada más en esta orden.`;
}
