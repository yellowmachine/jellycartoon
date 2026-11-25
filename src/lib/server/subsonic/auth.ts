import { eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { appPassword, user } from '#lib/server/db/schema.ts';
import { newAppPassword } from 'comun/server/subsonic/protocol.ts';
import { passwordMatches } from './protocol.ts';

/** A new password for apps, replacing the one before: 20 characters, in groups to type it. */
export async function generateAppPassword(userId: string) {
	const password = newAppPassword();
	await db
		.insert(appPassword)
		.values({ userId, password })
		.onConflictDoUpdate({ target: appPassword.userId, set: { password, createdAt: new Date() } });
	return password;
}

export async function revokeAppPassword(userId: string) {
	await db.delete(appPassword).where(eq(appPassword.userId, userId));
}

/** When the user's was made, or null without one. */
export async function appPasswordCreated(userId: string) {
	const [row] = await db
		.select({ createdAt: appPassword.createdAt })
		.from(appPassword)
		.where(eq(appPassword.userId, userId));
	return row?.createdAt ?? null;
}

/** The user an app's request is from: `u` is the account's email; null if it does not check out. */
export async function subsonicUser(params: URLSearchParams) {
	const email = params.get('u')?.trim().toLowerCase();
	if (!email) return null;
	const [row] = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			password: appPassword.password
		})
		.from(user)
		.innerJoin(appPassword, eq(appPassword.userId, user.id))
		.where(eq(sql`lower(${user.email})`, email));
	if (!row) return null;
	const matches = passwordMatches(row.password, {
		t: params.get('t'),
		s: params.get('s'),
		p: params.get('p')
	});
	return matches ? { id: row.id, name: row.name, email: row.email, role: row.role } : null;
}
