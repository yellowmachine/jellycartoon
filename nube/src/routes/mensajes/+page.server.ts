import type { PageServerLoad } from './$types';
import { familyPeople } from '#lib/server/agenda/agenda.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { calls } from '#lib/server/calls.ts';

/**
 * Mensajes (#551): who is who, to put a name on each message, and whom one may write to (as whom one
 * may call: the family, and the adults of linked families). The messages are the device's.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const [people, contacts] = await Promise.all([
		familyPeople(await kitchenOf(locals.user!.id)),
		calls.callable(locals.user!.id).catch(() => [])
	]);
	return {
		userId: locals.user!.id,
		names: {
			...Object.fromEntries(contacts.map((c) => [c.userId, c.name])),
			...Object.fromEntries(people.filter((p) => p.userId).map((p) => [p.userId!, p.name]))
		} as Record<string, string>,
		contacts: contacts.map((c) => ({ userId: c.userId, name: c.name, family: c.family ?? null }))
	};
};
