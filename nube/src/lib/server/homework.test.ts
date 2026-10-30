import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { AGE_BANDS, DEFAULT_RULES } from 'comun/homework.ts';
import * as schema from './db/schema.ts';
import { family, familyMember, user } from './db/schema.ts';
import { familyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';

/**
 * Homework in Seilide (#142), on a real Postgres (PGlite) as the app's role: proposed from the
 * house's dialogue by the family's AI, reviewed, given, done by the child, and its adults told.
 * The house, the AI and the phones' notices, faked.
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });

const asked: { path: string; body?: unknown }[] = [];
mock.module('#lib/server/house.ts', () => ({
	// The others' (timers, satellites), unused here: a mock is the whole process's.
	tellHouse: async () => ({ where: '' }),
	familyHasHouse: async () => true,
	HouseProblem: class extends Error {},
	askHouse: async (_: string, __: string, path: string, init?: RequestInit) => {
		asked.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		if (path === '/deberes/dialogo')
			return {
				titulo: 'Dexter · T1 E1',
				capitulos: [
					{ id: 7, name: '«Dexter», T1 E1 «Huevos»', dialogue: '[0:12] ¡Dee Dee, fuera!' }
				]
			};
		return { visto: [] };
	}
}));
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => 'clave' }));
mock.module('#lib/server/openrouter.ts', () => ({
	// satellite-voice.test.ts's, unused here.
	sayableError: (message: string) => message,
	speech: async () => ({ pcm: new Uint8Array(4), rate: 24_000 }),
	completeJson: async () => ({
		exercises: [
			{
				kind: 'choice',
				question: '¿A quién echa Dexter del laboratorio?',
				options: ['A Dee Dee', 'A su madre', 'A Mandark'],
				answer: 0,
				hint: 'Es su hermana.',
				expected: null,
				episode: 7,
				at: '0:12'
			},
			{
				kind: 'truefalse',
				question: 'Dexter tiene un laboratorio.',
				options: [],
				answer: true,
				hint: null,
				expected: null,
				episode: 7,
				at: null
			}
		]
	})
}));
const told: { to: string[]; title: string; url: string }[] = [];
mock.module('#lib/server/push.ts', () => ({
	notify: async (_: string, to: string[], m: { title: string; url: string }) =>
		void told.push({ to, ...m })
}));
// Their inbox (#331) tells the phones: faked as they are.
mock.module('#lib/server/inbox.ts', () => ({
	tell: async (_: string, to: string[], m: { title: string; url: string }) =>
		void told.push({ to, ...m })
}));

const hw = await import('./homework.ts');

const kitchen = (familyId: string, userId: string): Kitchen => ({
	familyId,
	userId,
	run: (fn) => withFamily(userId, (tx) => fn(tx))
});
const ana = kitchen('A', 'ana');
const lucia = kitchen('A', 'lucia');
const otra = kitchen('B', 'otra');
const asker = { userId: 'ana', email: 'ana@test.es' };
const band = AGE_BANDS.find((b) => b.id === 'primaria-1')!;

const person = (id: string, email = `${id}@test.es`) => ({
	id,
	name: id,
	email,
	createdAt: new Date(),
	updatedAt: new Date()
});

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db
		.insert(user)
		.values([
			person('ana'),
			person('alberto'),
			person('otra'),
			person('lucia', 'lucia@peques.invalid')
		]);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'alberto', familyId: 'A' },
		{ userId: 'lucia', familyId: 'A', role: 'peque' },
		{ userId: 'otra', familyId: 'B', role: 'admin' }
	]);
});

let id = 0;

describe('homework in Seilide', () => {
	test('proposed from the house’s dialogue, kept as a draft with its episodes’ names', async () => {
		id = await hw.createHomework(ana, asker, {
			kidId: 'lucia',
			episodeIds: [7],
			band,
			count: 2,
			language: 'es',
			rules: DEFAULT_RULES
		});
		expect(asked.at(-1)).toEqual({
			path: '/deberes/dialogo',
			body: { capitulos: [7], idioma: 'es' }
		});
		const draft = await hw.getHomework(ana, id);
		expect(draft).toMatchObject({
			status: 'draft',
			title: 'Dexter · T1 E1',
			episodeNames: { '7': '«Dexter», T1 E1 «Huevos»' }
		});
		expect(draft!.exercises).toHaveLength(2);
		// A draft is not the child's yet.
		expect(await hw.homeworkToDo(lucia, 'lucia')).toEqual([]);
	});

	test('another family does not see it', async () => {
		expect(await hw.getHomework(otra, id)).toBeNull();
		expect(await hw.homeworkOf(otra)).toEqual([]);
	});

	test('given, the child does it: checked here, and its adults told at the end', async () => {
		expect(await hw.assignHomework(ana, id)).toBe(true);
		expect((await hw.homeworkToDo(lucia, 'lucia')).map((h) => h.id)).toEqual([id]);
		// An adult cannot answer it in the child's name.
		expect(await hw.answerExercise(ana, id, 0, 0)).toBeNull();
		// Where the right ones ended up: the options are shuffled on checking the proposal.
		const [first, second] = (await hw.getHomework(ana, id))!.exercises;
		const right = first.answer!;
		const wrong = await hw.answerExercise(lucia, id, 0, (right + 1) % first.options.length);
		expect(wrong?.result).toMatchObject({ result: 'again' });
		expect((await hw.answerExercise(lucia, id, 0, right))?.result).toMatchObject({
			result: 'right'
		});
		const last = await hw.answerExercise(lucia, id, 1, second.answer!);
		expect(last?.done).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(told.at(-1)).toMatchObject({ url: `/deberes/${id}` });
		expect(told.at(-1)!.to.sort()).toEqual(['alberto', 'ana']);
		expect((await hw.getHomework(ana, id))?.status).toBe('done');
	});
});
