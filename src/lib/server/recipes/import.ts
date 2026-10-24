import { asc, eq } from 'drizzle-orm';
import { parseRecipe, type Recipe } from '#lib/recipe.ts';
import { getAppSetting, openRouterConfig, setAppSetting } from '#lib/server/app-settings.ts';
import { db } from '#lib/server/db/index.ts';
import { recipe } from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { fetchPublic } from '#lib/server/public-fetch.ts';
import { findRecipe, normalizeRecipe, readPage, type PageRecipe } from './schema-org.ts';

/**
 * The house's recipe book (#60): a recipe saved from the address of a cooking site's page. Its
 * schema.org Recipe is read (schema-org.ts); the AI makes its steps ready for the kitchen, short
 * and with their timers, from what the site says and nothing else. Without a key, the site's steps
 * as they are, with no timers; a page without a Recipe needs the AI to read its text.
 */

const USER_AGENT = 'JellyCartoon/1.0 (https://github.com/yellowmachine/jellycartoon)';
const MAX_PAGE_BYTES = 5_000_000;

const step = {
	type: 'object',
	properties: {
		text: { type: 'string' },
		timer_minutes: { type: ['number', 'null'] },
		timer_label: { type: ['string', 'null'] },
		timer_trigger: { type: ['string', 'null'] }
	},
	required: ['text', 'timer_minutes', 'timer_label', 'timer_trigger'],
	additionalProperties: false
};

/** The same rules as the voice's own recipes (voice/command.ts), for what a site wrote. */
const RULES = [
	'Preparas recetas para seguirlas por voz en la cocina, paso a paso, con temporizadores.',
	'Usa solo lo que dice la receta: no inventes ingredientes, cantidades, temperaturas ni tiempos, ni quites ninguno.',
	'En español: si la receta está en otro idioma, tradúcela.',
	'Pasos cortos, de una o dos frases, para oírlos de uno en uno: divide los largos, en el orden en que se hacen.',
	'Un tiempo que esperar que la receta dice («cuece 10 minutos», «hornea 35») es el temporizador de su paso: timer_minutes (en un intervalo, el menor), timer_label corto y como se diría («la pasta», «el horno»), y timer_trigger si el tiempo empieza con algo que se hará o pasará después («eches la pasta», «hierva el agua»); si no, null. Sin tiempo dicho, sin temporizador.',
	'Lo que se hace mientras corre un temporizador va en el texto de ese mismo paso: al acabar, se pasa al siguiente, que tiene que ser lo que toca entonces.'
].join('\n');

/** The site's steps, ready for the kitchen. */
async function prepareSteps(found: PageRecipe) {
	const { steps } = await completeJson<{ steps: unknown[] }>({
		system: RULES,
		prompt: [
			`Receta: ${found.title}${found.servings ? ` (${found.servings} personas)` : ''}`,
			`Ingredientes:\n${found.ingredients.map((i) => `- ${i}`).join('\n') || '(no dichos)'}`,
			`Pasos de la web:\n${found.instructions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
		].join('\n\n'),
		name: 'recipe_steps',
		label: `Receta «${found.title}»: pasos`,
		schema: {
			type: 'object',
			properties: { steps: { type: 'array', items: step } },
			required: ['steps'],
			additionalProperties: false
		},
		maxTokens: 8_000,
		timeoutMs: 90_000
	});
	return steps;
}

/** A page with no Recipe in its data: the AI reads its text, if it is one. */
async function readText(text: string, title: string | null) {
	const read = await completeJson<{
		is_recipe: boolean;
		title: string;
		servings: number | null;
		ingredients: string[];
		steps: unknown[];
	}>({
		system: `${RULES}\nTe llega el texto de una página web: saca de él la receta, sus ingredientes con sus cantidades y sus pasos. Si no hay una receta, is_recipe=false.`,
		prompt: `${title ? `Título de la página: ${title}\n\n` : ''}${text}`,
		name: 'recipe',
		label: `Receta de una página sin datos: «${title ?? 'sin título'}»`,
		schema: {
			type: 'object',
			properties: {
				is_recipe: { type: 'boolean' },
				title: { type: 'string' },
				servings: { type: ['integer', 'null'] },
				ingredients: { type: 'array', items: { type: 'string' } },
				steps: { type: 'array', items: step }
			},
			required: ['is_recipe', 'title', 'servings', 'ingredients', 'steps'],
			additionalProperties: false
		},
		maxTokens: 8_000,
		timeoutMs: 90_000
	});
	return read.is_recipe ? read : null;
}

const webAddress = (value: string | null, base: string) => {
	try {
		const url = value ? new URL(value, base) : null;
		return url && (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : null;
	} catch {
		return null;
	}
};

async function saved(sourceUrl: string) {
	const [found] = await db
		.select({ id: recipe.id })
		.from(recipe)
		.where(eq(recipe.sourceUrl, sourceUrl));
	return found?.id ?? null;
}

/**
 * The recipe at `address`, saved in the book; the one there was, if that page was saved already.
 * Why not, in Spanish, if it cannot be.
 */
export async function importRecipe(address: string, userId: string) {
	let url: URL;
	try {
		url = new URL(address.trim());
	} catch {
		throw new Error('Eso no es una dirección web');
	}
	url.hash = '';
	const already = await saved(url.href);
	if (already) return { id: already, existing: true };

	const page = await fetchPublic(url.href, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
		maxBytes: MAX_PAGE_BYTES
	});
	if (!/html/i.test(page.contentType)) throw new Error('Esa dirección no es una página web');
	// Redirected (a short link, http to https): saved as where it ended.
	const sourceUrl = page.url.replace(/#.*$/, '');
	const again = sourceUrl !== url.href && (await saved(sourceUrl));
	if (again) return { id: again, existing: true };

	const read = await readPage(page.body);
	const node = findRecipe(read.jsonLd);
	const found = node ? normalizeRecipe(node) : null;
	const { apiKey } = await openRouterConfig();

	let raw: Record<string, unknown>;
	if (found) {
		const steps = apiKey ? await prepareSteps(found) : found.instructions.map((text) => ({ text }));
		raw = { ...found, steps };
	} else {
		if (!apiKey)
			throw new Error(
				'Esta página no trae la receta en sus datos, y sin IA (Ajustes) no se puede leer'
			);
		if (read.text.length < 200) throw new Error('En esa página no hay una receta');
		const fromText = await readText(read.text, read.title);
		if (!fromText) throw new Error('En esa página no hay una receta');
		raw = fromText;
	}
	const parsed = parseRecipe(raw);
	if (typeof parsed === 'string') throw new Error(`No se pudo leer la receta: ${parsed}`);
	const host = new URL(sourceUrl).hostname.replace(/^www\./, '');
	const [row] = await db
		.insert(recipe)
		.values({
			...recipeFields(parsed),
			imageUrl: webAddress(found?.imageUrl ?? read.imageUrl, sourceUrl),
			sourceUrl,
			sourceName: read.siteName ?? host,
			createdBy: userId
		})
		.onConflictDoNothing()
		.returning({ id: recipe.id });
	const id = row?.id ?? (await saved(sourceUrl));
	if (!id) throw new Error('No se pudo guardar la receta');
	log.info('recetas', `Guardada la receta «${parsed.title}» de ${host}`, {
		recipeId: id,
		structured: Boolean(found),
		ai: Boolean(apiKey)
	});
	return { id, existing: !row };
}

const recipeFields = (r: Recipe) => ({
	title: r.title,
	servings: r.servings,
	ingredients: r.ingredients,
	steps: r.steps
});

/** The book, by title. */
export function listRecipes() {
	return db
		.select({
			id: recipe.id,
			title: recipe.title,
			imageUrl: recipe.imageUrl,
			sourceName: recipe.sourceName
		})
		.from(recipe)
		.orderBy(asc(recipe.title));
}

/** The recipe whose picture is behind the book's page, chosen from its page; `null`: none. */
export async function backdropRecipeId() {
	const id = Number(await getAppSetting('recipes_backdrop'));
	return Number.isInteger(id) && id > 0 ? id : null;
}

/** This recipe's picture behind the book's page, or (if it already is) no picture. */
export async function toggleBackdrop(id: number) {
	await setAppSetting('recipes_backdrop', (await backdropRecipeId()) === id ? null : String(id));
}

/** Its picture, if that recipe is still there and has one. */
export async function recipesBackdrop() {
	const id = await backdropRecipeId();
	if (id === null) return null;
	const [row] = await db
		.select({ imageUrl: recipe.imageUrl })
		.from(recipe)
		.where(eq(recipe.id, id));
	return row?.imageUrl ?? null;
}

/** One recipe, ready to cook (as the voice's), with where it came from. */
export async function getRecipe(id: number) {
	const [row] = await db.select().from(recipe).where(eq(recipe.id, id));
	return row ?? null;
}

export async function deleteRecipe(id: number) {
	await db.delete(recipe).where(eq(recipe.id, id));
}
