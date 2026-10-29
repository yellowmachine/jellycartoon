import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { family, familyMember, invitation, user } from './db/schema.ts';
import type { AnyDb } from './family-scope.ts';
import { invitationExpiry, invitationStatus, type InvitationStatus } from '../invitation.ts';

/**
 * Invitations (family.schema.ts, `invitation`): made, read by their link's token and accepted. Apart
 * from the app's database, to be tested on PGlite as family-scope.ts; the app's are invitations.ts.
 * Joining a family is done inside it, as row-level security asks: `app.user_id` to see one's own
 * membership, `app.family_id` to write into the family.
 */

export const newToken = () => randomBytes(32).toString('base64url');

const sameEmail = (column: typeof invitation.email | typeof user.email, email: string) =>
	eq(sql`lower(${column})`, email.trim().toLowerCase());

/** Not accepted nor cancelled: perhaps lapsed. */
const open = and(isNull(invitation.usedAt), isNull(invitation.cancelledAt));

export type Invited = { ok: true; id: string; token: string } | { ok: false; problem: string };

export type Accepted = { ok: true; familyId: string } | { ok: false; problem: string };

export interface FoundInvitation {
	email: string;
	role: 'admin' | 'member';
	status: InvitationStatus;
	expiresAt: Date;
	/** Its family's name; none, a family of their own still to name. */
	familyName: string | null;
	inviterName: string | null;
	/** Whether that email already has an account: then they enter, rather than sign up. */
	hasAccount: boolean;
}

export function invitationScope(db: AnyDb, { role }: { role?: string } = {}) {
	const inTx = <T>(fn: (tx: AnyDb) => Promise<T>) =>
		db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			return fn(tx as unknown as AnyDb);
		});

	return {
		/**
		 * An invitation for this email, into this family (none: one of their own), with a new link
		 * lasting 7 days. The same email's open one, into the same family, is renewed (a new token: the
		 * old link stops working); a lapsed one elsewhere is cancelled. Someone of the family already is
		 * not invited; someone of another is, and will be told on accepting.
		 */
		invite(i: {
			email: string;
			familyId: string | null;
			role: 'admin' | 'member';
			invitedBy: string | null;
		}): Promise<Invited> {
			const email = i.email.trim();
			return inTx(async (tx) => {
				if (i.familyId) {
					await tx.execute(sql`select set_config('app.family_id', ${i.familyId}, true)`);
					const [member] = await tx
						.select({ id: user.id })
						.from(familyMember)
						.innerJoin(user, eq(user.id, familyMember.userId))
						.where(sameEmail(user.email, email));
					if (member) return { ok: false, problem: 'Ya está en la familia' };
				}
				const token = newToken();
				const [already] = await tx
					.select()
					.from(invitation)
					.where(and(sameEmail(invitation.email, email), open))
					.for('update');
				if (already) {
					if (already.familyId === i.familyId) {
						await tx
							.update(invitation)
							.set({ token, role: i.role, invitedBy: i.invitedBy, expiresAt: invitationExpiry() })
							.where(eq(invitation.id, already.id));
						return { ok: true, id: already.id, token };
					}
					if (invitationStatus(already) === 'pending')
						return { ok: false, problem: 'Ese email ya tiene una invitación de otra familia' };
					await tx
						.update(invitation)
						.set({ cancelledAt: new Date() })
						.where(eq(invitation.id, already.id));
				}
				const id = randomUUID();
				await tx.insert(invitation).values({
					id,
					email,
					token,
					familyId: i.familyId,
					role: i.familyId ? i.role : 'admin',
					invitedBy: i.invitedBy,
					expiresAt: invitationExpiry()
				});
				return { ok: true, id, token };
			});
		},

		/** What the link invites to, for its page; null if there is no such link. */
		byToken(token: string): Promise<FoundInvitation | null> {
			return inTx(async (tx) => {
				const [found] = await tx
					.select({
						email: invitation.email,
						role: invitation.role,
						familyId: invitation.familyId,
						expiresAt: invitation.expiresAt,
						usedAt: invitation.usedAt,
						cancelledAt: invitation.cancelledAt,
						inviterName: user.name
					})
					.from(invitation)
					.leftJoin(user, eq(user.id, invitation.invitedBy))
					.where(eq(invitation.token, token));
				if (!found) return null;
				let familyName: string | null = null;
				if (found.familyId) {
					await tx.execute(sql`select set_config('app.family_id', ${found.familyId}, true)`);
					const [f] = await tx
						.select({ name: family.name })
						.from(family)
						.where(eq(family.id, found.familyId));
					familyName = f?.name ?? null;
				}
				const [account] = await tx
					.select({ id: user.id })
					.from(user)
					.where(sameEmail(user.email, found.email));
				return {
					email: found.email,
					role: found.role,
					status: invitationStatus(found),
					expiresAt: found.expiresAt,
					familyName,
					inviterName: found.inviterName,
					hasAccount: Boolean(account)
				};
			});
		},

		/**
		 * The invitation accepted by whoever has its email's account: into its family with its role,
		 * or into a new family of theirs, named `familyName`, as its administrator. One family each.
		 */
		accept(
			token: string,
			who: { id: string; email: string },
			familyName?: string
		): Promise<Accepted> {
			return inTx(async (tx) => {
				await tx.execute(sql`select set_config('app.user_id', ${who.id}, true)`);
				const [inv] = await tx
					.select()
					.from(invitation)
					.where(eq(invitation.token, token))
					.for('update');
				if (!inv) return { ok: false, problem: 'Ese enlace no es de ninguna invitación' };
				const status = invitationStatus(inv);
				if (status === 'accepted') return { ok: false, problem: 'Esta invitación ya se usó' };
				if (status === 'cancelled') return { ok: false, problem: 'Esta invitación se canceló' };
				if (status === 'expired')
					return { ok: false, problem: 'Esta invitación caducó: pide que te la manden otra vez' };
				if (inv.email.trim().toLowerCase() !== who.email.trim().toLowerCase())
					return { ok: false, problem: `Esta invitación es para ${inv.email}` };
				const [mine] = await tx
					.select({ familyId: familyMember.familyId })
					.from(familyMember)
					.where(eq(familyMember.userId, who.id));
				if (mine) return { ok: false, problem: 'Ya estás en una familia' };

				let familyId = inv.familyId;
				if (!familyId) {
					const name = familyName?.trim().slice(0, 60);
					if (!name) return { ok: false, problem: 'Ponle un nombre a tu familia' };
					familyId = randomUUID();
					await tx.execute(sql`select set_config('app.family_id', ${familyId}, true)`);
					await tx.insert(family).values({ id: familyId, name });
				} else {
					await tx.execute(sql`select set_config('app.family_id', ${familyId}, true)`);
				}
				await tx
					.insert(familyMember)
					.values({ userId: who.id, familyId, role: inv.familyId ? inv.role : 'admin' });
				await tx.update(invitation).set({ usedAt: new Date() }).where(eq(invitation.id, inv.id));
				return { ok: true, familyId };
			});
		},

		/** The open, unlapsed invitation for this email: only with one can someone sign up. */
		async pendingFor(email: string) {
			const [found] = await db
				.select({ id: invitation.id })
				.from(invitation)
				.where(and(sameEmail(invitation.email, email), open, gt(invitation.expiresAt, new Date())));
			return found ?? null;
		},

		/** The family's open invitations (lapsed ones too, to send again), newest first. */
		async ofFamily(familyId: string) {
			const rows = await db
				.select()
				.from(invitation)
				.where(and(eq(invitation.familyId, familyId), open))
				.orderBy(sql`${invitation.createdAt} desc`);
			return rows.map((r) => ({
				id: r.id,
				email: r.email,
				role: r.role,
				token: r.token,
				expiresAt: r.expiresAt,
				status: invitationStatus(r)
			}));
		},

		/** Cancelled by its family: only one of its own, not yet accepted. */
		async cancel(id: string, familyId: string | null) {
			await db
				.update(invitation)
				.set({ cancelledAt: new Date() })
				.where(
					and(
						eq(invitation.id, id),
						familyId ? eq(invitation.familyId, familyId) : isNull(invitation.familyId),
						open
					)
				);
		}
	};
}
