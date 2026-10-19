import { spokenLeft } from '#lib/timer-names.ts';

/**
 * A recipe being cooked (#60): written by the AI when asked to cook something, kept in the browser
 * of the kitchen's device, and sent with each voice command, so that «ya hierve la pasta» is
 * understood: which step, which timer, what comes next.
 */

/** The wait of a step: its timer. */
export interface RecipeTimer {
	/** «la pasta», as the timers are called. */
	label: string;
	minutes: number;
	/** What it waits for, to start: «eches la pasta». Null: it starts with the step. */
	trigger: string | null;
}

export interface RecipeStep {
	/** Short, to be read aloud. */
	text: string;
	timer: RecipeTimer | null;
}

export interface Recipe {
	title: string;
	servings: number | null;
	/** With their amounts: «200 g de espaguetis». */
	ingredients: string[];
	steps: RecipeStep[];
}

const MAX_STEPS = 30;
const MAX_INGREDIENTS = 40;

const text = (value: unknown, max: number) =>
	typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/**
 * A recipe as the AI wrote it (start_recipe's arguments), or why it is not one. Also what is
 * saved in the browser, read back.
 */
export function parseRecipe(value: unknown): Recipe | string {
	const v = (value ?? {}) as Record<string, unknown>;
	const title = text(v.title, 100);
	if (!title) return 'Falta el nombre de la receta.';
	const steps = (Array.isArray(v.steps) ? v.steps : []).slice(0, MAX_STEPS).flatMap((s) => {
		const step = (s ?? {}) as Record<string, unknown>;
		const said = text(step.text, 400);
		if (!said) return [];
		// As saved (`timer`) or as the AI's flat arguments (`timer_minutes`…).
		const t = (step.timer ?? {}) as Record<string, unknown>;
		const minutes = Number(t.minutes ?? step.timer_minutes);
		const label = text(t.label ?? step.timer_label, 60);
		return [
			{
				text: said,
				timer:
					Number.isFinite(minutes) && minutes > 0
						? {
								label: label ?? title.toLowerCase(),
								minutes: Math.min(minutes, 24 * 60),
								trigger: text(t.trigger ?? step.timer_trigger, 100)
							}
						: null
			}
		];
	});
	if (!steps.length) return 'Faltan los pasos.';
	const servings = Number(v.servings);
	return {
		title,
		servings: Number.isInteger(servings) && servings > 0 ? servings : null,
		ingredients: (Array.isArray(v.ingredients) ? v.ingredients : [])
			.flatMap((i) => text(i, 100) ?? [])
			.slice(0, MAX_INGREDIENTS),
		steps
	};
}

/** «el temporizador «la pasta», 9 min, cuando eches la pasta». */
export const describeTimer = (t: RecipeTimer) =>
	`temporizador «${t.label}», ${spokenLeft(t.minutes * 60)}${t.trigger ? `, cuando ${t.trigger}` : ''}`;

/** For the AI, with each command: the whole recipe, and where the cook is. */
export function describeRecipe(recipe: Recipe, step: number) {
	return [
		`${recipe.title}${recipe.servings ? ` (${recipe.servings} personas)` : ''}.`,
		`Ingredientes: ${recipe.ingredients.join('; ') || 'no dichos'}.`,
		'Pasos:',
		...recipe.steps.map(
			(s, i) =>
				`${i + 1}. ${s.text}${s.timer ? ` [${describeTimer(s.timer)}]` : ''}${i === step ? ' ← va por aquí' : ''}`
		)
	].join('\n');
}

/**
 * What is said when a step's timer ends: that it is done and the step after it, or that the
 * recipe is finished. Null if none of `labels` is a step's timer.
 */
export function afterTimer(
	recipe: Recipe,
	labels: string[],
	same: (a: string, b: string) => boolean
) {
	const index = recipe.steps.findIndex(
		(s) => s.timer && labels.some((label) => same(label, s.timer!.label))
	);
	if (index === -1) return null;
	const next = recipe.steps[index + 1];
	return {
		step: next ? index + 1 : index,
		say: next ? `Siguiente paso: ${next.text}` : 'Y con esto, has terminado. ¡Que aproveche!'
	};
}
