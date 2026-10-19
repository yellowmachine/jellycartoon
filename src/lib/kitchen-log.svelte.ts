/**
 * What was said in the kitchen (#60), to see it at a glance in /voz: each order and its answer, and
 * what the device said by itself (a timer that ended, a recipe's step), with their time. From when
 * kitchen mode is turned on to when it is turned off; kept in this browser, so that reloading the
 * page does not lose it. Only shown: the AI gets its own few last turns (voice-client).
 */

const STORAGE_KEY = 'kitchen-log';
const MAX_ENTRIES = 50;

export interface KitchenLogEntry {
	id: string;
	/** Date.now() */
	at: number;
	/** What was said or written; none for what the device said by itself. */
	said: string | null;
	reply: string;
}

class KitchenLog {
	/** The newest first. */
	entries = $state<KitchenLogEntry[]>([]);
	/** Kitchen mode is on (kitchen-mode.svelte.ts says so): only then is anything kept. */
	active = false;
	#loaded = false;

	load() {
		if (this.#loaded) return;
		this.#loaded = true;
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
			if (Array.isArray(saved))
				this.entries = saved.filter(
					(e): e is KitchenLogEntry =>
						typeof e?.id === 'string' &&
						Number.isFinite(e.at) &&
						typeof e.reply === 'string' &&
						(e.said === null || typeof e.said === 'string')
				);
		} catch {
			// Private windows, or something else saved there.
		}
	}

	#save() {
		try {
			if (this.entries.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
			else localStorage.removeItem(STORAGE_KEY);
		} catch {
			// Same.
		}
	}

	add(said: string | null, reply: string) {
		if (!this.active || !reply.trim()) return;
		this.entries = [
			{ id: crypto.randomUUID(), at: Date.now(), said, reply: reply.trim() },
			...this.entries
		].slice(0, MAX_ENTRIES);
		this.#save();
	}

	/** Kitchen mode off: the session is over. */
	clear() {
		this.entries = [];
		this.#save();
	}
}

export const kitchenLog = new KitchenLog();
