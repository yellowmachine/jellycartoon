import { error } from '@sveltejs/kit';
import type { Kitchen } from '#lib/server/fridge.ts';

/** The podcasts are each person's: only in the name of one of the family (its email). */
export function personOnly(k: Kitchen) {
	if (!k.userId) error(403, 'Los podcasts son de cada persona: falta quién, o no es de la familia');
	return k;
}
