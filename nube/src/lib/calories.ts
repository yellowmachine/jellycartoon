import type { LineTag } from 'comun/expenses.ts';

/**
 * Calorías (#562): the kcal the family buys, from its receipts' lines, by day and person. Not what
 * anyone eats: what is bought is not what is eaten, and not everything bought has a receipt.
 */

/** Lines with these tags are never food: not sent to the AI, not counted. */
export const NON_FOOD_TAGS: readonly LineTag[] = [
	'Limpieza',
	'Higiene',
	'Medicamentos',
	'Mascotas',
	'Ropa y calzado',
	'Hogar y bricolaje',
	'Combustible'
];

export const isFoodTag = (tag: string) => !NON_FOOD_TAGS.includes(tag as LineTag);

/** What an adult needs a day, about: the line the weeks are compared with. */
export const ADULT_KCAL = 2200;

/** A child, or a person without an account (they are the children), counts as this much of one. */
export const CHILD_SHARE = 0.6;

/** What a product is, as estimated or corrected (food_estimate). */
export interface FoodEstimate {
	food: boolean;
	byWeight: boolean;
	grams: number;
	kcal100: number;
}

/** No line weighs more than this: a quantity misread (1234 for 1,234 kg) does not count. */
const MAX_LINE_GRAMS = 50_000;

/**
 * A line's kcal: by weight, its quantity in kg; otherwise its units (one if not said) of the
 * product's grams. Not food, or nothing to go by, 0.
 */
export function lineKcal(estimate: FoodEstimate, quantity: number | null) {
	if (!estimate.food || estimate.kcal100 <= 0) return 0;
	const grams =
		estimate.byWeight && quantity !== null && quantity > 0
			? quantity * 1000
			: (quantity !== null && quantity > 0 ? quantity : 1) * estimate.grams;
	if (!(grams > 0) || grams > MAX_LINE_GRAMS) return 0;
	return (grams * estimate.kcal100) / 100;
}

/** Who the kcal are divided among: adults, and children at CHILD_SHARE. */
export interface People {
	adults: number;
	children: number;
}

/** As many adults as they make: at least one, so nothing divides by 0. */
export const peopleWeight = (p: People) => Math.max(1, p.adults + p.children * CHILD_SHARE);

/** «2 adultos y 2 peques». */
export function peopleText(p: People) {
	const adults = p.adults === 1 ? '1 adulto' : `${p.adults} adultos`;
	if (!p.children) return adults;
	return `${adults} y ${p.children === 1 ? '1 peque' : `${p.children} peques`}`;
}

/** «1.850 kcal». */
export const kcal = (value: number) => `${Math.round(value).toLocaleString('es-ES')} kcal`;
