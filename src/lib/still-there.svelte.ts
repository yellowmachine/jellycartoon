/**
 * «¿Sigues ahí?» (#77) in this browser: episodes «siguiente automático» started by itself since
 * anyone last touched anything here. A module, so it goes on from one episode's page to the next.
 */

/** The server hears of a touch at most this often: for /infantil's «Última interacción». */
const TELL_EVERY_MS = 30_000;

class StillThere {
	unattended = 0;
	#toldAt = 0;

	/** The countdown ended and played the next one. */
	startedByItself() {
		this.unattended++;
	}

	/** A touch, a click or a key: someone is there. */
	someoneThere() {
		this.unattended = 0;
		const now = Date.now();
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
