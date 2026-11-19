import { eq } from 'drizzle-orm';
import type { LngLat } from 'comun/road.ts';
import { family, familyPerson, user } from './db/schema.ts';
import { withFamily } from './family.ts';
import { familyLinks } from './family-links.ts';
import { calls } from './calls.ts';
import { tell } from './inbox.ts';
import type { Callable } from '#lib/calls.ts';

/**
 * «Manda mi ubicación a mamá» (#550): where one is now, or the trip as it goes (#81's link), to
 * someone they may call (#330): their family, or an adult of a linked family (#464). In their Buzón
 * and on their phone, as a message; nothing else kept.
 */

export type LocationToSend = { kind: 'aqui'; at: LngLat } | { kind: 'viaje'; url: string };

/** Who this one may send it to: the same as they may call. */
export const sendableTo = (userId: string): Promise<Callable[]> => calls.callable(userId);

/** Maps, by its documented address: on a phone it opens the maps app, with «Cómo llegar». */
export const mapsUrl = ([lon, lat]: LngLat) =>
	`https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;

const hourOf = (d: Date) =>
	d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });

/** Sent: the name it went to; else why not. */
export async function sendLocation(
	userId: string,
	toId: string,
	what: LocationToSend
): Promise<{ name: string } | { problem: string }> {
	const to = (await sendableTo(userId)).find((p) => p.userId === toId);
	if (!to) return { problem: 'No se la puedes mandar a esa persona' };
	const me = await withFamily(userId, async (tx, m) => {
		const [row] = await tx
			.select({ person: familyPerson.name, account: user.name })
			.from(user)
			.leftJoin(familyPerson, eq(familyPerson.userId, user.id))
			.where(eq(user.id, userId));
		const [fam] = await tx
			.select({ name: family.name })
			.from(family)
			.where(eq(family.id, m.familyId));
		return {
			familyId: m.familyId,
			name: row?.person ?? row?.account ?? 'Alguien',
			family: fam?.name
		};
	});
	// Theirs, or the linked family's they are in.
	const familyId = to.family
		? (await familyLinks.linkedFamilyOf(userId, toId))?.familyId
		: me.familyId;
	if (!familyId) return { problem: 'Esa familia ya no está vinculada' };
	// To another family, said whose: they may know more than one Miguel.
	const from = to.family && me.family ? `${me.name} (${me.family})` : me.name;
	const now = new Date();
	await tell(
		familyId,
		[toId],
		what.kind === 'aqui'
			? {
					kind: 'ubicacion',
					title: `📍 ${from} está aquí`,
					body: `Mandada a las ${hourOf(now)}. Tócala para verla en el mapa y cómo llegar.`,
					tag: `ubicacion-${crypto.randomUUID()}`,
					url: mapsUrl(what.at),
					ttl: 6 * 3600,
					fromUserId: userId
				}
			: {
					kind: 'ubicacion',
					title: `🚗 ${from} comparte su viaje contigo`,
					body: `Desde las ${hourOf(now)}: por dónde va, en directo, hasta que llegue o lo deje de compartir.`,
					tag: `viaje-${userId}`,
					url: what.url,
					ttl: 2 * 3600,
					fromUserId: userId
				}
	);
	console.info('[ubicación] Mandada', { kind: what.kind, linked: Boolean(to.family) });
	return { name: to.name };
}
