import { kitchenLog } from '#lib/kitchen-log.svelte.ts';
import { afterTimer, describeRecipe, parseRecipe, type Recipe } from 'comun/recipe.ts';
import { sameLabel } from 'comun/timer-names.ts';

/**
 * The recipe being cooked on this device (#60): the one the AI wrote, and the step the cook is on.
 * Kept in this browser (localStorage), like the timers: the kitchen's phone or tablet has it, and
 * reloading the page does not lose it.
 */

const STORAGE_KEY = 'kitchen-recipe';

class RecipeInProgress {
	current = $state<Recipe | null>(null);
	/** Index in `current.steps`. */
	step = $state(0);
	#loaded = false;

	load() {
		if (this.#loaded) return;
		this.#loaded = true;
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
			const recipe = saved && parseRecipe(saved.recipe);
			if (recipe && typeof recipe !== 'string') {
				this.current = recipe;
				this.step = this.#within(Number(saved.step));
			}
		} catch {
			// Private windows, or something else saved there.
		}
	}

	#save() {
		try {
			if (this.current)
				localStorage.setItem(
					STORAGE_KEY,
					JSON.stringify({ recipe: this.current, step: this.step })
				);
			else localStorage.removeItem(STORAGE_KEY);
		} catch {
			// Same.
		}
	}

	#within(step: number) {
		const last = (this.current?.steps.length ?? 1) - 1;
		return Number.isInteger(step) ? Math.min(Math.max(step, 0), last) : 0;
	}

	/** A new one, or the same one rewritten (another ingredient), on `step`: instead of the one there was. */
	start(recipe: Recipe, step = 0) {
		this.current = recipe;
		this.step = this.#within(step);
		this.#save();
	}

	go(step: number) {
		if (!this.current) return;
		this.step = this.#within(step);
		this.#save();
	}

	end() {
		this.current = null;
		this.step = 0;
		this.#save();
	}

	/**
	 * Tapped (wet hands, no voice): that step, read aloud too. On the kitchen's device the screen
	 * may be across the room.
	 */
	goAndSay(step: number) {
		if (!this.current) return;
		this.go(step);
		const text = this.current.steps[this.step]!.text;
		kitchenLog.add(null, `Paso ${this.step + 1}: ${text}`);
		say(text);
	}

	/** For the AI, with each command; null without one. */
	describe() {
		return this.current ? describeRecipe(this.current, this.step) : null;
	}

	/**
	 * Some timers ended: if one is a step's, the recipe goes on to the step after it, and that is
	 * what is said, to go with «Ya está: la pasta».
	 */
	afterTimers(labels: string[]) {
		if (!this.current) return null;
		const next = afterTimer(this.current, labels, sameLabel);
		if (!next) return null;
		this.go(next.step);
		return next.say;
	}
}

/** With the device's own voice, as the voice answers: https://developer.mozilla.org/docs/Web/API/SpeechSynthesis */
function say(text: string) {
	if (!('speechSynthesis' in window)) return;
	speechSynthesis.cancel();
	const utterance = new SpeechSynthesisUtterance(text);
	utterance.lang = 'es-ES';
	speechSynthesis.speak(utterance);
}

export const recipe = new RecipeInProgress();
