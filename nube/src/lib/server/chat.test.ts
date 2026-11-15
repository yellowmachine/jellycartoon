import { beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { expense, family, user } from './db/schema.ts';
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

// The real module's, as the tests after this one use them (a mock is the process's); its chat, faked.
const openrouter = await import('#lib/server/openrouter.ts');
mock.module('#lib/server/openrouter.ts', () => ({
	...openrouter,
	chatWithTools: async (r: { messages: ToolChatMessage[] }) => {
		sent.push(structuredClone(r.messages));
		if (fails) throw new Error(fails);
		return {
			...(answers.shift() ?? { content: 'Vale.', toolCalls: [] }),
			usage: null,
			fellBack: null
		};
	}
}));
mock.module('#lib/server/family-settings.ts', () => ({ openRouterKey: async () => 'clave' }));
mock.module('#lib/server/voice/settings.ts', () => ({
	FALLBACK_VOICE_MODEL: 'otro/modelo',
	voiceSettings: async () => ({ conversationModel: 'modelo', style: null })
}));
// As other tests fake it (a mock is the process's), with what this module uses of it.
const fridge = () => ({
	dayOf: (d: Date) => d.toISOString().slice(0, 10),
	today: () => '2026-11-11',
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

// The sections' reads (#504), faked: chat-reads.test.ts tests them; here, that the chat uses them.
const reads: { userId: string; name: string; args: Record<string, unknown> }[] = [];
mock.module('#lib/server/chat-reads.ts', () => ({
	READ_TOOLS: [
		{
			type: 'function',
			function: { name: 'read_spending', description: '', parameters: { type: 'object' } }
		}
	],
	isRead: (name: string) => name === 'read_spending',
	runRead: async (_k: Kitchen, userId: string, name: string, args: Record<string, unknown>) => {
		reads.push({ userId, name, args });
		return '2026-10: 412,30 € (Comida 300,00 €, Casa 112,30 €)';
	}
}));

// Reports (#505), faked: reports.test.ts tests them; here, the card and what the AI is told.
const madeReports: { userId: string; args: Record<string, unknown> }[] = [];
mock.module('#lib/server/reports.ts', () => ({
	makeReport: async (_k: Kitchen, userId: string, args: Record<string, unknown>) => {
		if (!args.title) return 'Falta el título.';
		madeReports.push({ userId, args });
		return {
			id: 7,
			title: args.title,
			from: '2026-07-12',
			to: '2026-07-14',
			pieces: [{ text: '', kind: 'cifras', block: null, empty: 'nada' }],
			excluded: []
		};
	},
	describePiece: (p: { kind: string; empty: string }) => `[${p.kind}: ${p.empty}]`
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

test('messages over 30 days old go each night, only that family’s; the recent stay', async () => {
	answers = ['Vieja.', 'Nueva.', 'De la otra casa.'].map((content) => ({ content, toolCalls: [] }));
	await chat.askChat(ana, { id: 'ana', name: 'Ana' }, 'Hace mucho');
	await db.execute(sql`update chat_message set created_at = now() - interval '31 days'`);
	await chat.askChat(ana, { id: 'ana', name: 'Ana' }, 'Hoy');
	const other = kitchen('B', 'otro');
	await chat.askChat(other, { id: 'otro', name: 'Otro' }, 'Hace mucho');
	await db.execute(
		sql`update chat_message set created_at = now() - interval '31 days' where family_id = 'B'`
	);
	expect(await chat.forgetOldChat(ana)).toBe(2);
	expect((await chat.chatHistory(ana, 'ana')).map((m) => m.text)).toEqual(['Hoy', 'Nueva.']);
	expect(await chat.chatHistory(other, 'otro')).toHaveLength(2);
});

test('the AI reads only the last two hours of the chat; the person sees it all', async () => {
	answers = ['De ayer.', 'De ahora.', 'Vale.'].map((content) => ({ content, toolCalls: [] }));
	await chat.askChat(ana, { id: 'ana', name: 'Ana' }, 'Ayer en Gastos');
	await db.execute(sql`update chat_message set created_at = now() - interval '3 hours'`);
	await chat.askChat(ana, { id: 'ana', name: 'Ana' }, 'Hace un rato');
	sent.length = 0;
	await chat.askChat(ana, { id: 'ana', name: 'Ana' }, 'Ahora');
	expect(sent[0]!.slice(1).map((m) => m.content)).toEqual(['Hace un rato', 'De ahora.', 'Ahora']);
	expect(await chat.chatHistory(ana, 'ana')).toHaveLength(6);
});

test('a failure saves nothing, in our words; an empty question is refused', async () => {
	fails = 'No queda saldo en OpenRouter';
	await expect(chat.askChat(ana, { id: 'ana', name: 'Ana' }, 'Hola')).rejects.toThrow(
		'No queda saldo en OpenRouter'
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
	expect(sent).toHaveLength(6);
	expect(JSON.stringify(sent[1])).toContain('Cuécelas');
	expect(a!.text).toContain('No sé qué contestar');
});

test('from the panel beside a section (#504), the AI is told which one; from its page, none', async () => {
	await chat.askChat(ana, { id: 'ana', name: 'Ana' }, '¿Y el mes pasado?', 'Dinero');
	expect(sent[0]![0]!.content as string).toContain('al lado de la sección «Dinero»');
	await chat.askChat(ana, { id: 'ana', name: 'Ana' }, 'Hola');
	expect(sent[1]![0]!.content as string).not.toContain('al lado de la sección');
});

test('it reads a section (#504) as the person who asks, and answers with what it read', async () => {
	answers = [
		{
			content: null,
			toolCalls: [call('read_spending', { from_month: '2026-10', to_month: '2026-10' })]
		},
		{ content: 'En octubre, 412,30 €: sobre todo comida.', toolCalls: [] }
	];
	const [, a] = await chat.askChat(ana, { id: 'ana', name: 'Ana' }, '¿Cuánto gastamos en octubre?');
	expect(reads).toEqual([
		{ userId: 'ana', name: 'read_spending', args: { from_month: '2026-10', to_month: '2026-10' } }
	]);
	expect(sent[1]!.at(-1)).toMatchObject({
		role: 'tool',
		content: expect.stringContaining('412,30 €')
	});
	expect(a!.text).toBe('En octubre, 412,30 €: sobre todo comida.');
	expect(a!.cards).toEqual([]);
	// The AI is offered the reads, and told to read before it answers.
	expect(sent[0]![0]!.content as string).toContain('léelos con sus herramientas');
});

test('it shows (#504 phase 3): a page already filtered and a chart with the database’s figures', async () => {
	await db.insert(expense).values([
		{
			familyId: 'A',
			date: '2026-10-02',
			store: 'Repsol',
			category: 'Gasolina',
			total: 6000,
			source: 'mano'
		},
		{
			familyId: 'A',
			date: '2026-10-05',
			store: 'Lidl',
			category: 'Supermercado',
			total: 2500,
			source: 'mano'
		}
	]);
	answers = [
		{
			content: null,
			toolCalls: [
				call('open_page', { page: 'analisis', months: 12 }),
				call('show_spending_chart', { from_month: '2026-10', to_month: '2026-10' }),
				call('open_page', { page: 'https://malo.example' }, 'malo')
			]
		},
		{ content: 'En octubre, sobre todo gasolina.', toolCalls: [] }
	];
	const [, a] = await chat.askChat(ana, { id: 'ana', name: 'Ana' }, '¿En qué gasto más?');
	expect(a!.cards).toEqual([
		{ kind: 'pagina', href: '/gastos/analisis?meses=12', label: 'Dinero → Análisis, 12 meses' },
		{
			kind: 'bloque',
			block: {
				kind: 'barras',
				title: 'Gastos de 2026-10',
				labels: ['2026-10'],
				series: [
					{ name: 'Gasolina', values: [6000] },
					{ name: 'Supermercado', values: [2500] }
				]
			}
		}
	]);
	// The AI was told the chart's figures, and that the made-up page is not one.
	const told = sent[1]!.filter((m) => m.role === 'tool').map((m) => m.content as string);
	expect(told[1]).toContain('2026-10: 85,00 € (Gasolina 60,00 €, Supermercado 25,00 €)');
	expect(told[2]).toBe('No hay ninguna página «https://malo.example».');
	// Asked again, it knows what it showed.
	await chat.askChat(ana, { id: 'ana', name: 'Ana' }, '¿Y eso es mucho?');
	const history = JSON.stringify(sent.at(-1));
	expect(history).toContain('[Página abierta: Dinero → Análisis, 12 meses]');
	expect(history).toContain('[Gráfica enseñada: «Gastos de 2026-10»');
	await db.delete(expense);
});

test('a report (#505): made as who asks, its card, and later the AI knows it', async () => {
	answers = [
		{
			content: null,
			toolCalls: [
				call('make_report', {
					title: 'Alicante, julio',
					from_day: '2026-07-12',
					to_day: '2026-07-14',
					pieces: [{ text: '', block: 'cifras' }]
				}),
				call('make_report', { title: '' }, 'mal')
			]
		},
		{ content: 'Ya lo tienes en Informes.', toolCalls: [] }
	];
	const [, a] = await chat.askChat(ana, { id: 'ana', name: 'Ana' }, 'Hazme un informe del viaje');
	expect(a!.cards).toEqual([
		{ kind: 'informe', id: 7, title: 'Alicante, julio', from: '2026-07-12', to: '2026-07-14' }
	]);
	expect(madeReports.map((r) => r.userId)).toEqual(['ana']);
	const told = sent
		.at(-1)!
		.filter((m) => m.role === 'tool')
		.map((m) => m.content as string);
	expect(told[0]).toContain('[cifras: nada]');
	expect(told[1]).toBe('Falta el título.');
	await chat.askChat(ana, { id: 'ana', name: 'Ana' }, '¿Dónde está?');
	expect(JSON.stringify(sent.at(-1))).toContain(
		'[Informe guardado en Informes: «Alicante, julio», del 2026-07-12 al 2026-07-14]'
	);
});
