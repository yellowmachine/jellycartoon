import { beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, user } from './db/schema.ts';
import { familyOnlyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';
import type { ToolCall, ToolChatMessage } from './openrouter.ts';

/**
 * «Preguntar» (#470) on a real Postgres (PGlite) as the app's role: the AI (faked) proposes, the
 * cards are saved with its answer, nothing reaches the list until it is tapped, and only the card's
 * own items; another person of the family sees nothing of it.
 */

const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const kitchen = (familyId: string, userId: string): Kitchen => ({
	familyId,
	userId,
	run: (fn) => asFamily(familyId, fn)
});

/** The faked AI: each call, the next of these answers; what it was sent, kept. */
type Answer = { content: string | null; toolCalls: ToolCall[] };
let answers: Answer[] = [];
const sent: ToolChatMessage[][] = [];
let fails: string | null = null;
const onList: string[] = [];
const added: string[][] = [];
const savedRecipes: { title: string; from: string }[] = [];

mock.module('#lib/server/openrouter.ts', () => ({
	chatWithTools: async (r: { messages: ToolChatMessage[] }) => {
		sent.push(structuredClone(r.messages));
		if (fails) throw new Error(fails);
		return {
			...(answers.shift() ?? { content: 'Vale.', toolCalls: [] }),
			usage: null,
			fellBack: null
		};
	},
	sayableError: (m: string) => (m.startsWith('OpenRouter:') ? 'La IA no ha podido contestar' : m)
}));
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => 'clave' }));
mock.module('#lib/server/voice/settings.ts', () => ({
	FALLBACK_VOICE_MODEL: 'otro/modelo',
	voiceSettings: async () => ({ conversationModel: 'modelo', style: null })
}));
// As other tests fake it (a mock is the process's), with what this module uses of it.
const fridge = () => ({
	houseKitchen: () => {
		throw new Error('Sin cocina en esta prueba');
	},
	kitchenOf: () => {
		throw new Error('Sin cocina en esta prueba');
	},
	toBuy: async () => [...onList],
	addItems: async (_k: Kitchen, texts: string[]) => {
		added.push(texts);
		return texts;
	}
});
mock.module('#lib/server/fridge.ts', fridge);
mock.module('#lib/server/recipes/import.ts', () => ({
	listRecipes: async () => [{ id: 7, title: 'Lentejas', sourceName: 'x', imageUrl: null }],
	getRecipe: async (_k: Kitchen, id: number) =>
		id === 7
			? {
					title: 'Lentejas',
					servings: 4,
					ingredients: ['lentejas'],
					steps: [{ text: 'Cuécelas', timer: null }]
				}
			: savedRecipes[id - 100]
				? { title: savedRecipes[id - 100]!.title, servings: null, ingredients: [], steps: [] }
				: null,
	saveWrittenRecipe: async (_k: Kitchen, r: { title: string }, from: string) => {
		savedRecipes.push({ title: r.title, from });
		return 100 + savedRecipes.length - 1;
	}
}));

const chat = await import('./chat.ts');

const ana = kitchen('A', 'ana');
const pepe = kitchen('A', 'pepe');
const call = (name: string, args: unknown, id = name): ToolCall => ({
	id,
	type: 'function',
	function: { name, arguments: JSON.stringify(args) }
});
const BIZCOCHO = {
	title: 'Bizcocho de yogur',
	servings: 8,
	ingredients: ['1 yogur', '3 huevos'],
	steps: [
		{ text: 'Mezcla todo' },
		{ text: 'Hornea', timer_minutes: 35, timer_label: 'el bizcocho' }
	]
};

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(user).values(
		['ana', 'pepe', 'otro'].map((id) => ({
			id,
			name: id,
			email: `${id}@test.es`,
			createdAt: new Date(),
			updatedAt: new Date()
		}))
	);
});

beforeEach(async () => {
	answers = [];
	sent.length = 0;
	added.length = 0;
	onList.length = 0;
	fails = null;
	await db.execute(sql`delete from chat_message`);
});

test('the AI proposes: a shopping card and a recipe card, saved with its words; nothing added', async () => {
	onList.push('Azúcar');
	answers = [
		{
			content: null,
			toolCalls: [
				call('propose_shopping', {
					items: ['Harina (1 kg)', 'Levadura química', 'harina (1 kg)', ' ']
				}),
				call('propose_recipe', BIZCOCHO)
			]
		},
		{ content: 'El bizcocho de yogur es lo más fácil para empezar.', toolCalls: [] }
	];
	const [q, a] = await chat.askChat(ana, { id: 'ana', name: 'Ana' }, ' Quiero hacer repostería ');
	expect(q!.text).toBe('Quiero hacer repostería');
	expect(a!.text).toBe('El bizcocho de yogur es lo más fácil para empezar.');
	expect(a!.cards).toEqual([
		{ kind: 'compra', items: ['Harina (1 kg)', 'Levadura química'], added: null },
		{
			kind: 'receta',
			recipe: {
				title: 'Bizcocho de yogur',
				servings: 8,
				ingredients: ['1 yogur', '3 huevos'],
				steps: [
					{ text: 'Mezcla todo', timer: null },
					{ text: 'Hornea', timer: { label: 'el bizcocho', minutes: 35, trigger: null } }
				]
			},
			savedId: null
		}
	]);
	expect(added).toEqual([]);
	// The AI was told the list and the recipe book; and, the second time, what its tools did.
	const system = sent[0]![0]!.content as string;
	expect(system).toContain('- Azúcar');
	expect(system).toContain('Lentejas [receta 7]');
	expect(sent[1]!.filter((m) => m.role === 'tool')).toHaveLength(2);
	expect((await chat.chatHistory(ana, 'ana')).map((m) => m.role)).toEqual(['user', 'assistant']);
});

test('only the ticked items of the card reach the list, never one it did not propose', async () => {
	answers = [
		{ content: 'Toma.', toolCalls: [call('propose_shopping', { items: ['Huevos', 'Harina'] })] },
		{ content: 'Toma.', toolCalls: [] }
	];
	const [, a] = await chat.askChat(ana, { id: 'ana', name: 'Ana' }, '¿Qué compro?');
	expect(await chat.addFromCard(ana, 'ana', a!.id, 0, ['Harina', 'Tabaco'])).toEqual(['Harina']);
	expect(added).toEqual([['Harina']]);
	await chat.addFromCard(ana, 'ana', a!.id, 0, ['Huevos']);
	const [, after] = await chat.chatHistory(ana, 'ana');
	expect(after!.cards[0]).toEqual({
		kind: 'compra',
		items: ['Huevos', 'Harina'],
		added: ['Harina', 'Huevos']
	});
	// Told next time: what was added.
	await chat.askChat(ana, { id: 'ana', name: 'Ana' }, '¿Y ahora?');
	expect(JSON.stringify(sent.at(-1))).toContain('Añadió a la lista: Harina; Huevos');
});

test('a recipe card into Recetas once; told as saved afterwards', async () => {
	answers = [{ content: 'Aquí la tienes.', toolCalls: [call('propose_recipe', BIZCOCHO)] }];
	const [, a] = await chat.askChat(ana, { id: 'ana', name: 'Ana' }, 'La receta');
	const id = await chat.saveRecipeFromCard(ana, 'ana', a!.id, 0);
	expect(await chat.saveRecipeFromCard(ana, 'ana', a!.id, 0)).toBe(id);
	expect(savedRecipes.filter((r) => r.from === `${a!.id}/0`)).toHaveLength(1);
	// Not a shopping card: nothing to add.
	expect(await chat.addFromCard(ana, 'ana', a!.id, 0, ['1 yogur'])).toBeNull();
	await chat.askChat(ana, { id: 'ana', name: 'Ana' }, '¿Y para 12?');
	expect(JSON.stringify(sent.at(-1))).toContain(`guardada en el recetario (receta ${id})`);
});

test('another person of the family sees nothing of it, nor acts on its cards; nor another family', async () => {
	answers = [{ content: 'Toma.', toolCalls: [call('propose_shopping', { items: ['Huevos'] })] }];
	const [, a] = await chat.askChat(ana, { id: 'ana', name: 'Ana' }, 'Hola');
	expect(await chat.chatHistory(pepe, 'pepe')).toEqual([]);
	expect(await chat.addFromCard(pepe, 'pepe', a!.id, 0, ['Huevos'])).toBeNull();
	expect(await chat.chatHistory(kitchen('B', 'ana'), 'ana')).toEqual([]);
	await chat.clearChat(pepe, 'pepe');
	expect(await chat.chatHistory(ana, 'ana')).toHaveLength(2);
	await chat.clearChat(ana, 'ana');
	expect(await chat.chatHistory(ana, 'ana')).toEqual([]);
	expect(added).toEqual([]);
});

test('a failure saves nothing, in our words; an empty question is refused', async () => {
	fails = 'OpenRouter: 500';
	await expect(chat.askChat(ana, { id: 'ana', name: 'Ana' }, 'Hola')).rejects.toThrow(
		'La IA no ha podido contestar'
	);
	expect(await chat.chatHistory(ana, 'ana')).toEqual([]);
	await expect(chat.askChat(ana, { id: 'ana', name: 'Ana' }, '   ')).rejects.toThrow(
		'Escribe algo'
	);
});

test('it reads a saved recipe when asked, and stops after a few rounds of tools', async () => {
	answers = Array.from({ length: 10 }, (_, i) => ({
		content: null,
		toolCalls: [call('read_recipe', { id: 7 }, `r${i}`)]
	}));
	const [, a] = await chat.askChat(ana, { id: 'ana', name: 'Ana' }, '¿Cómo hago las lentejas?');
	expect(sent).toHaveLength(4);
	expect(JSON.stringify(sent[1])).toContain('Cuécelas');
	expect(a!.text).toContain('No sé qué contestar');
});
