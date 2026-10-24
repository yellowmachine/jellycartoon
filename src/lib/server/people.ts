import { asc, eq, sql } from 'drizzle-orm';
import QRCode from 'qrcode';
import { ORIGIN } from '$app/env/private';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { account, invitation, kidProfile, user, userSettings } from '#lib/server/db/schema.ts';
import { isAdmin } from '#lib/server/app-settings.ts';
import { invitations, takeIssued } from '#lib/server/invitations.ts';
import { isKid, KIDS_ROLE } from '#lib/server/kids.ts';
import { avatar, isAvatar } from '#lib/avatars.ts';

/**
 * «Personas de la casa» (#157): the administrator creates every account, adults and children, each
 * with a drawing. An adult has no password until they choose it, with a link (and its QR) the
 * administrator gives them; the same, if they forget it.
 */

/** The adults of the house in Ajustes: who manages, who entered, whose link is still waiting. */
export async function houseAdults() {
	const [rows, links, [first]] = await Promise.all([
		db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				avatar: userSettings.avatar,
				hasPassword: sql<boolean>`exists (select 1 from ${account} where ${account.userId} = ${user.id} and ${account.providerId} = 'credential')`
			})
			.from(user)
			.leftJoin(userSettings, eq(userSettings.userId, user.id))
			.where(sql`${user.role} is distinct from ${KIDS_ROLE}`)
			.orderBy(asc(user.createdAt)),
		invitations(),
		db.select({ id: user.id }).from(user).orderBy(asc(user.createdAt)).limit(1)
	]);
	const now = new Date();
	return rows.map((r) => {
		const link = links.find((l) => l.userId === r.id && !l.usedAt && l.expiresAt > now);
		return {
			...r,
			avatar: isAvatar(r.avatar) ? r.avatar : null,
			admin: r.id === first?.id,
			/** Its link works until then. */
			linkUntil: link?.expiresAt ?? null
		};
	});
}

/** An adult's account, without a password: they choose it with their link. */
export async function createAdult(person: { name: string; email: string; avatar: string }) {
	const { user: created } = await auth.api.createUser({
		body: { name: person.name, email: person.email, role: 'user' }
	});
	await setAvatar(created.id, person.avatar);
	return created.id;
}

/** An adult's drawing, chosen by the administrator or by themselves. */
export async function setAvatar(userId: string, id: string) {
	const value = isAvatar(id) ? id : null;
	await db
		.insert(userSettings)
		.values({ userId, avatar: value })
		.onConflictDoUpdate({ target: userSettings.userId, set: { avatar: value } });
}

/**
 * A new link for this adult to choose their password, and its QR as SVG: the one before stops
 * working. Not for children (their way in is another) nor for the administrator (their own link,
 * made in their own session, would be a way around their second step).
 */
export async function invite(userId: string) {
	const [person] = await db
		.select({ email: user.email, role: user.role })
		.from(user)
		.where(eq(user.id, userId));
	if (!person || isKid(person)) throw new Error('No es un adulto de la casa');
	if (await isAdmin(userId)) throw new Error('El administrador entra con su contraseña');
	await auth.api.requestPasswordReset({ body: { email: person.email } });
	const token = takeIssued(userId);
	if (!token) throw new Error('No se pudo hacer el enlace');
	const url = `${ORIGIN}/bienvenida?token=${token}`;
	const [link] = await db
		.select({ expiresAt: invitation.expiresAt })
		.from(invitation)
		.where(eq(invitation.userId, userId));
	return {
		userId,
		url,
		until: link.expiresAt,
		qr: await QRCode.toString(url, { type: 'svg', margin: 1 })
	};
}

/** The drawing on someone's round badge: a child's from kid_profile, an adult's from Ajustes. */
export async function avatarOf(person: { id: string; role?: string | null }) {
	if (isKid(person)) {
		const [row] = await db
			.select({ avatar: kidProfile.avatar })
			.from(kidProfile)
			.where(eq(kidProfile.userId, person.id));
		return avatar(row?.avatar);
	}
	const [row] = await db
		.select({ avatar: userSettings.avatar })
		.from(userSettings)
		.where(eq(userSettings.userId, person.id));
	return isAvatar(row?.avatar) ? avatar(row.avatar) : null;
}
