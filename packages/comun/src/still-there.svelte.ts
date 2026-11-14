import { longUnattended } from 'comun/still-there.ts';

/**
 * «¿Sigues ahí?» (#77) in this browser: when anyone last touched anything here, and whether the
 * episode on came by itself («siguiente automático») since. A module, so it goes on from one
 * episode's page to the next. The player (comun Player) asks; each app may hear of the touches
 * (`onTouch`: the house's /infantil «Última interacción»).
 */

/** The app hears of a touch at most this often. */
const TELL_EVERY_MS = 30_000;

class StillThere {
	/** The last touch, a click or a key; the app opening counts as one. */
	touchedAt = Date.now();
	/** The countdown ended and played the next one, with nobody touching anything since. */
	byItself = false;
	/** Told of a touch, at most every 30 s. */
	onTouch: (() => void) | null = null;
	#toldAt = 0;

	/** The countdown ended and played the next one. */
	startedByItself() {
		this.byItself = true;
	}

	/** Started by itself, with nobody touching anything for `minutes`: time to ask. */
	shouldAsk(minutes: number | null) {
		return this.byItself && longUnattended(this.touchedAt, minutes);
	}

	/** A touch, a click or a key: someone is there. */
	someoneThere() {
		const now = Date.now();
		this.touchedAt = now;
		this.byItself = false;
		if (!this.onTouch || now - this.#toldAt < TELL_EVERY_MS) return;
		this.#toldAt = now;
		this.onTouch();
	}
}

export const stillThere = new StillThere();
