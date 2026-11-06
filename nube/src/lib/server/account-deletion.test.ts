import { beforeEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import {
	calendarEvent,
	calendarEventPerson,
	expense,
	family,
	familyMember,
	familyPerson,
	invitation,
	kidGuardian,
	medication,
	note,
	oauthClient,
	paper,
	paperPerson,
	plannedTrip,
	user,
	waitlist
} from './db/schema.ts';
import { familyScope } from './family-scope.ts';
import { handOverAdmin, stepDownAdmin } from './family-role.ts';

mock.module('#lib/server/storage.ts', () => ({
	storageReady: true,
	putFile: async () => {},
	removeFile: async () => {},
	removeAllFiles: async () => {},
	readFile: async () => null,
	listFiles: async () => [],
	fileResponse: async () => new Response()
}));

const { accountDeletionScope, MustHandOver } = await import('./account-deletion-scope.ts');

/** On a real Postgres (PGlite), as the app's role; the account deleted as Better Auth does. */
const db = drizzle(new PGlite(), { schema });
const deletion = accountDeletionScope(db, { role: 'app_user' });
const withFamily = familyScope(db, { role: 'app_user' });

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});

async function deleted(id: string) {
	const plan = await deletion.prepare(id, `${id}@test.es`, id);
	await db.delete(user).where(eq(user.id, id));
	return plan;
}

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
});

beforeEach(async () => {
	await db.delete(oauthClient);
	await db.delete(invitation);
	await db.delete(waitlist);
	await db.delete(family);
	await db.delete(user);
	await db.insert(user).values(['ana', 'luis', 'peque', 'sola', 'hijo'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'S', name: 'Casa de Sola' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'luis', familyId: 'A', role: 'member' },
		{ userId: 'peque', familyId: 'A', role: 'peque' },
		{ userId: 'sola', familyId: 'S', role: 'admin' },
		{ userId: 'hijo', familyId: 'S', role: 'peque' }
	]);
	await db.insert(familyPerson).values([
		{ id: 1, familyId: 'A', userId: 'ana', name: 'Ana' },
		{ id: 2, familyId: 'A', userId: 'luis', name: 'Luis' },
		{ id: 3, familyId: 'A', userId: 'peque', name: 'Peque' }
	]);
});

describe('what deleting would do (#315)', () => {
	test('the only administrator with other adults hands over first', async () => {
		expect(await deletion.stateOf('ana')).toEqual({ kind: 'handOverFirst' });
		await expect(deletion.prepare('ana', 'ana@test.es', 'ana')).rejects.toBeInstanceOf(
			MustHandOver
		);
		await handOverAdmin(withFamily, 'ana', 'luis');
		expect(await deletion.stateOf('ana')).toEqual({ kind: 'stays' });
	});

	test('a member, or an administrator with another, just goes', async () => {
		expect(await deletion.stateOf('luis')).toEqual({ kind: 'stays' });
		await db.execute(sql`update family_member set role = 'admin' where user_id = 'luis'`);
		expect(await deletion.stateOf('ana')).toEqual({ kind: 'stays' });
	});

	test('the only adult is told of the family and its children', async () => {
		expect(await deletion.stateOf('sola')).toEqual({ kind: 'lastAdult', kids: ['hijo'] });
	});

	test('someone with no family only has an account', async () => {
		await db.delete(familyMember).where(eq(familyMember.userId, 'luis'));
		expect(await deletion.stateOf('luis')).toEqual({ kind: 'noFamily' });
	});
});

describe('what goes with an account (#315)', () => {
	const dose = { startDay: '2026-11-01', times: ['09:00'] };

	test('their medication goes, and only theirs, whoever wrote it', async () => {
		await db.insert(medication).values([
			{ familyId: 'A', personId: 2, name: 'De Luis', userId: 'ana', ...dose },
			{ familyId: 'A', personId: 3, name: 'De Peque', userId: 'luis', ...dose }
		]);
		await deleted('luis');
		const left = await db.select().from(medication);
		expect(left.map((m) => m.name)).toEqual(['De Peque']);
		expect(left[0].userId).toBeNull();
	});

	test('an event only theirs goes; a shared one stays, with their name', async () => {
		await db.insert(calendarEvent).values([
			{ id: 1, familyId: 'A', title: 'Solo Luis', startDay: '2026-11-02', userId: 'ana' },
			{ id: 2, familyId: 'A', title: 'De los dos', startDay: '2026-11-03', userId: 'luis' }
		]);
		await db.insert(calendarEventPerson).values([
			{ familyId: 'A', eventId: 1, personId: 2 },
			{ familyId: 'A', eventId: 2, personId: 2 },
			{ familyId: 'A', eventId: 2, personId: 1 }
		]);
		await deleted('luis');
		const left = await db.select().from(calendarEvent);
		expect(left.map((e) => e.title)).toEqual(['De los dos']);
		const [them] = await db.select().from(familyPerson).where(eq(familyPerson.id, 2));
		expect(them).toMatchObject({ userId: null, name: 'luis' });
	});

	test('with nothing shared left, their person goes too', async () => {
		await deleted('luis');
		expect(await db.select().from(familyPerson).where(eq(familyPerson.id, 2))).toEqual([]);
	});

	test('a paper only theirs goes with its file; a shared one stays', async () => {
		const p = { familyId: 'A', category: 'otros', userId: 'ana' };
		await db.insert(paper).values([
			{ id: 1, name: 'x', file: 'suyo.pdf', ...p },
			{ id: 2, name: 'y', file: 'compartido.pdf', ...p }
		]);
		await db.insert(paperPerson).values([
			{ familyId: 'A', paperId: 1, personId: 2 },
			{ familyId: 'A', paperId: 2, personId: 2 },
			{ familyId: 'A', paperId: 2, personId: 1 }
		]);
		const plan = await deleted('luis');
		expect((await db.select().from(paper)).map((x) => x.file)).toEqual(['compartido.pdf']);
		expect(plan.files).toContainEqual({ area: 'papeles', name: 'suyo.pdf' });
		expect(plan.files).not.toContainEqual({ area: 'papeles', name: 'compartido.pdf' });
	});

	test('their private trip goes; what they wrote in the family stays, without them', async () => {
		await db.insert(plannedTrip).values([
			{ id: 1, familyId: 'A', name: 'Privado', private: true, userId: 'luis' },
			{ id: 2, familyId: 'A', name: 'De todos', private: false, userId: 'luis' }
		]);
		await db.insert(expense).values({
			familyId: 'A',
			date: '2026-11-01',
			store: 'Tienda',
			total: 100,
			category: 'otros',
			source: 'mano',
			userId: 'luis'
		});
		await deleted('luis');
		expect((await db.select().from(plannedTrip)).map((t) => t.name)).toEqual(['De todos']);
		expect((await db.select().from(expense))[0].userId).toBeNull();
	});

	test('their note goes by the account, and its audio is on the list', async () => {
		await db.insert(note).values({
			familyId: 'A',
			userId: 'luis',
			text: 'Nota',
			audio: 'n.webm',
			source: 'pagina'
		});
		const plan = await deleted('luis');
		expect(await db.select().from(note)).toEqual([]);
		expect(plan.files).toContainEqual({ area: 'notas', name: 'n.webm' });
	});

	test('their address goes from the invitations and the waiting list', async () => {
		await db.insert(invitation).values({ id: 'i', email: 'LUIS@test.es', familyId: 'A' });
		await db.insert(waitlist).values({ id: 'w', email: 'luis@test.es', name: 'Luis' });
		await deleted('luis');
		expect(await db.select().from(invitation)).toEqual([]);
		expect(await db.select().from(waitlist)).toEqual([]);
	});

	test('a child left with no adult is said, to whoever administers', async () => {
		await db.insert(kidGuardian).values({ familyId: 'A', kidId: 'peque', guardianId: 'luis' });
		const plan = await deleted('luis');
		expect(plan.orphanKids).toEqual(['peque']);
		expect(plan.admins).toEqual(['ana']);
		expect(plan.familyGone).toBe(false);
	});

	test('a child with another adult is not', async () => {
		await db.insert(kidGuardian).values([
			{ familyId: 'A', kidId: 'peque', guardianId: 'luis' },
			{ familyId: 'A', kidId: 'peque', guardianId: 'ana' }
		]);
		expect((await deleted('luis')).orphanKids).toEqual([]);
	});

	test('the only adult: the family goes, with its children’s accounts and its house’s way in', async () => {
		await db.insert(oauthClient).values({
			id: 'c',
			clientId: 'c',
			referenceId: 'S',
			redirectUris: ['https://casa/'],
			createdAt: new Date(),
			updatedAt: new Date()
		});
		const plan = await deleted('sola');
		expect(plan).toMatchObject({ familyId: 'S', familyGone: true });
		expect((await db.select().from(family)).map((f) => f.id)).toEqual(['A']);
		expect(await db.select().from(user).where(eq(user.id, 'hijo'))).toEqual([]);
		expect(await db.select().from(oauthClient)).toEqual([]);
	});

	test('another family is not touched', async () => {
		await deleted('sola');
		expect((await db.select().from(familyMember)).map((m) => m.userId).sort()).toEqual([
			'ana',
			'luis',
			'peque'
		]);
	});
});

describe('no longer administering (#315)', () => {
	test('with another administrator, yes; the last one, no', async () => {
		await db.execute(sql`update family_member set role = 'admin' where user_id = 'luis'`);
		expect(await stepDownAdmin(withFamily, 'ana')).toEqual({ ok: true });
		expect((await stepDownAdmin(withFamily, 'luis')).ok).toBe(false);
		const roles = await db.select().from(familyMember).where(eq(familyMember.familyId, 'A'));
		expect(roles.filter((r) => r.role === 'admin').map((r) => r.userId)).toEqual(['luis']);
	});

	test('not by someone who does not administer', async () => {
		expect((await stepDownAdmin(withFamily, 'luis')).ok).toBe(false);
	});
});
