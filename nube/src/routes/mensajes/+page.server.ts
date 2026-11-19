import type { PageServerLoad } from './$types';
import { familyPeople } from '#lib/server/agenda/agenda.ts';
import { kitchenOf } from '#lib/server/fridge.ts';

/** Mensajes (#551): who is who, to put a name on each message; the messages are the device's. */
export const load: PageServerLoad = async ({ locals }) => {
	const people = await familyPeople(await kitchenOf(locals.user!.id));
	return {
		userId: locals.user!.id,
		names: Object.fromEntries(people.filter((p) => p.userId).map((p) => [p.userId!, p.name]))
	};
};
