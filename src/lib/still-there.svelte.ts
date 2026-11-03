import { longUnattended } from '#lib/still-there.ts';

/**
 * «¿Sigues ahí?» (#77) in this browser: when anyone last touched anything here, and whether the
 * episode on came by itself («siguiente automático») since. A module, so it goes on from one
 * episode's page to the next.
 */

/** The server hears of a touch at most this often: for /infantil's «Última interacción». */
const TELL_EVERY_MS = 30_000;

class StillThere {
	/** The last touch, a click or a key; the app opening counts as one. */
	touchedAt = Date.now();
	/** The countdown ended and played the next one, with nobody touching anything since. */
	byItself = false;
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
		if (now - this.#toldAt < TELL_EVERY_MS) return;
		this.#toldAt = now;
		void fetch('/api/sigues-ahi', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ state: 'here' })
		}).catch(() => {});
	}
}

export const stillThere = new StillThere();
