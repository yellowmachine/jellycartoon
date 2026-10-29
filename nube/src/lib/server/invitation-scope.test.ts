import { beforeAll, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, invitation, user } from './db/schema.ts';
import { invitationScope } from './invitation-scope.ts';

/**
 * Invitations on a real Postgres (PGlite, in memory) with the migrations as they are, as the app's
 * role (`app_user`, like production's `nube_app`), to whom row-level security applies.
 */
const db = drizzle(new PGlite(), { schema });
const invitations = invitationScope(db, { role: 'app_user' });

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});
const who = (id: string) => ({ id, email: `${id}@test.es` });

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.insert(user).values(['ana', 'nuevo', 'otra', 'berta', 'carlos'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'berta', familyId: 'B', role: 'admin' }
	]);
});

describe('invitations', () => {
	test('into a family: its page, then in with its role, once', async () => {
		const made = await invitations.invite({
			email: 'Nuevo@test.es',
			familyId: 'A',
			role: 'member',
			invitedBy: 'ana'
		});
		if (!made.ok) throw new Error(made.problem);
		expect(await invitations.byToken(made.token)).toMatchObject({
			familyName: 'Casa A',
			inviterName: 'ana',
			status: 'pending',
			hasAccount: true
		});
		expect(await invitations.pendingFor('nuevo@test.es')).not.toBeNull();
		expect(await invitations.accept(made.token, who('nuevo'))).toEqual({ ok: true, familyId: 'A' });
		const [m] = await db.select().from(familyMember).where(eq(familyMember.userId, 'nuevo'));
		expect(m).toMatchObject({ familyId: 'A', role: 'member' });
		const [u] = await db.select().from(user).where(eq(user.id, 'nuevo'));
		expect(u.emailVerified).toBe(true);
		expect(await invitations.accept(made.token, who('nuevo'))).toMatchObject({ ok: false });
		expect(await invitations.pendingFor('nuevo@test.es')).toBeNull();
	});

	test('someone already of the family is not invited', async () => {
		expect(
			await invitations.invite({
				email: 'ana@test.es',
				familyId: 'A',
				role: 'member',
				invitedBy: 'ana'
			})
		).toMatchObject({ ok: false });
	});

	test('a new family of their own, named on accepting, as its administrator', async () => {
		const made = await invitations.invite({
			email: 'otra@test.es',
			familyId: null,
			role: 'member',
			invitedBy: null
		});
		if (!made.ok) throw new Error(made.problem);
		expect((await invitations.byToken(made.token))?.familyName).toBeNull();
		expect(await invitations.accept(made.token, who('otra'), '  ')).toMatchObject({ ok: false });
		const done = await invitations.accept(made.token, who('otra'), 'Casa Otra');
		if (!done.ok) throw new Error(done.problem);
		const [f] = await db.select().from(family).where(eq(family.id, done.familyId));
		expect(f.name).toBe('Casa Otra');
		const [m] = await db.select().from(familyMember).where(eq(familyMember.userId, 'otra'));
		expect(m.role).toBe('admin');
	});

	test('only by its email, and not by someone in a family already', async () => {
		const made = await invitations.invite({
			email: 'carlos@test.es',
			familyId: 'A',
			role: 'member',
			invitedBy: 'ana'
		});
		if (!made.ok) throw new Error(made.problem);
		expect(await invitations.accept(made.token, who('berta'))).toMatchObject({ ok: false });
		const toBerta = await invitations.invite({
			email: 'berta@test.es',
			familyId: 'A',
			role: 'member',
			invitedBy: 'ana'
		});
		if (!toBerta.ok) throw new Error(toBerta.problem);
		expect(await invitations.accept(toBerta.token, who('berta'))).toEqual({
			ok: false,
			problem: 'Ya estás en una familia'
		});
	});

	test('sent again: a new link, the old one dead; another family cannot take it while open', async () => {
		const first = await invitations.invite({
			email: 'x@test.es',
			familyId: 'A',
			role: 'member',
			invitedBy: 'ana'
		});
		const again = await invitations.invite({
			email: 'x@test.es',
			familyId: 'A',
			role: 'admin',
			invitedBy: 'ana'
		});
		if (!first.ok || !again.ok) throw new Error('not invited');
		expect(again.id).toBe(first.id);
		expect(await invitations.byToken(first.token)).toBeNull();
		expect((await invitations.byToken(again.token))?.role).toBe('admin');
		expect(
			await invitations.invite({
				email: 'x@test.es',
				familyId: 'B',
				role: 'member',
				invitedBy: 'berta'
			})
		).toMatchObject({ ok: false });
	});

	test('lapsed: not accepted, not for signing up, and another family may invite', async () => {
		const made = await invitations.invite({
			email: 'y@test.es',
			familyId: 'A',
			role: 'member',
			invitedBy: 'ana'
		});
		if (!made.ok) throw new Error(made.problem);
		await db
			.update(invitation)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(invitation.id, made.id));
		expect((await invitations.byToken(made.token))?.status).toBe('expired');
		expect(await invitations.pendingFor('y@test.es')).toBeNull();
		expect(
			await invitations.invite({
				email: 'y@test.es',
				familyId: 'B',
				role: 'member',
				invitedBy: 'berta'
			})
		).toMatchObject({ ok: true });
	});

	test('cancelled, only by its own family', async () => {
		const made = await invitations.invite({
			email: 'z@test.es',
			familyId: 'A',
			role: 'member',
			invitedBy: 'ana'
		});
		if (!made.ok) throw new Error(made.problem);
		await invitations.cancel(made.id, 'B');
		expect((await invitations.byToken(made.token))?.status).toBe('pending');
		await invitations.cancel(made.id, 'A');
		expect((await invitations.byToken(made.token))?.status).toBe('cancelled');
		expect((await invitations.ofFamily('A')).map((i) => i.email)).not.toContain('z@test.es');
	});
});
