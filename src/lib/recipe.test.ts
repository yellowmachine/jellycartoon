import { describe, expect, test } from 'bun:test';
import { afterTimer, describeRecipe, parseRecipe, type Recipe } from './recipe.ts';
import { sameLabel } from './timer-names.ts';

/** As the AI writes it: start_recipe's arguments. */
const carbonara = {
	title: 'Espaguetis a la carbonara',
	servings: 4,
	ingredients: ['400 g de espaguetis', '150 g de guanciale', '4 yemas', '80 g de pecorino'],
	steps: [
		{ text: 'Pon a hervir una olla grande de agua con sal.' },
		{
			text: 'Echa los espaguetis.',
			timer_minutes: 9,
			timer_label: 'la pasta',
			timer_trigger: 'eches la pasta'
		},
		{ text: 'Mientras, dora el guanciale en una sartén sin aceite.' },
		{ text: 'Escurre la pasta y mézclala con las yemas y el queso, fuera del fuego.' }
	]
};

describe('parseRecipe', () => {
	test("the AI's arguments, as a recipe", () => {
		const recipe = parseRecipe(carbonara) as Recipe;
		expect(recipe.servings).toBe(4);
		expect(recipe.steps).toHaveLength(4);
		expect(recipe.steps[0]!.timer).toBeNull();
		expect(recipe.steps[1]!.timer).toEqual({
			label: 'la pasta',
			minutes: 9,
			trigger: 'eches la pasta'
		});
	});

	test('read back as saved, the same', () => {
		const recipe = parseRecipe(carbonara) as Recipe;
		expect(parseRecipe(JSON.parse(JSON.stringify(recipe)))).toEqual(recipe);
	});

	test("a timer without a name takes the recipe's; without minutes, none", () => {
		const recipe = parseRecipe({
			title: 'Bizcocho',
			steps: [
				{ text: 'Hornea.', timer_minutes: 35 },
				{ text: 'Desmolda.', timer_label: 'el molde', timer_minutes: 0 }
			]
		}) as Recipe;
		expect(recipe.steps[0]!.timer).toEqual({ label: 'bizcocho', minutes: 35, trigger: null });
		expect(recipe.steps[1]!.timer).toBeNull();
		expect(recipe.servings).toBeNull();
	});

	test('without a name or steps, why not', () => {
		expect(parseRecipe({ steps: [{ text: 'Algo' }] })).toBe('Falta el nombre de la receta.');
		expect(parseRecipe({ title: 'Nada', steps: [{ text: ' ' }] })).toBe('Faltan los pasos.');
		expect(parseRecipe(null)).toBe('Falta el nombre de la receta.');
	});
});

test('describeRecipe: the steps, their timers, and where the cook is', () => {
	const text = describeRecipe(parseRecipe(carbonara) as Recipe, 1);
	expect(text).toContain('Espaguetis a la carbonara (4 personas).');
	expect(text).toContain(
		'2. Echa los espaguetis. [temporizador «la pasta», 9 min, cuando eches la pasta] ← va por aquí'
	);
	expect(text).not.toContain('1. Pon a hervir una olla grande de agua con sal. ←');
});

describe('afterTimer', () => {
	const recipe = parseRecipe(carbonara) as Recipe;

	test("a step's timer: the step after it", () => {
		expect(afterTimer(recipe, ['La pasta'], sameLabel)).toEqual({
			step: 2,
			say: 'Siguiente paso: Mientras, dora el guanciale en una sartén sin aceite.'
		});
	});

	test('another timer: nothing to say', () => {
		expect(afterTimer(recipe, ['el horno'], sameLabel)).toBeNull();
	});

	test('the last step: finished', () => {
		const last = parseRecipe({
			title: 'Huevo pasado por agua',
			steps: [{ text: 'Cuécelo.', timer_minutes: 3, timer_label: 'el huevo' }]
		}) as Recipe;
		expect(afterTimer(last, ['el huevo'], sameLabel)).toEqual({
			step: 0,
			say: 'Y con esto, has terminado. ¡Que aproveche!'
		});
	});
});
