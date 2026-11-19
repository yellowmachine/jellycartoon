import { Messenger, type StoredMessage } from './messenger.ts';
import { idbStore } from './idb-store.ts';
import { httpTransport } from './http-transport.ts';

/**
 * Mensajes (#551) in this browser: whether this device has them on, the family's conversation and
 * what was said in it, kept up to date while the page is open («hay algo nuevo», then it asks).
 */
export class MessagesClient {
	phase = $state<'loading' | 'off' | 'ready' | 'failed'>('loading');
	problem = $state<string | null>(null);
	conversation = $state<string | null>(null);
	list = $state<StoredMessage[]>([]);
	/** Nobody else with messages on yet: what is written now, only this person's devices read. */
	alone = $state(false);
	#m: Messenger;
	#live: EventSource | null = null;
	#userId: string;

	constructor(userId: string) {
		this.#userId = userId;
		this.#m = new Messenger(idbStore(userId), httpTransport, userId);
	}

	async start() {
		try {
			const d = await this.#m.device();
			if (!d) {
				this.phase = 'off';
				return;
			}
			await this.#open();
		} catch (err) {
			this.#failed(err);
		}
	}

	/** Messages on here: its keys made in this device. */
	async turnOn(name: string) {
		this.phase = 'loading';
		try {
			await this.#m.setup(name);
			await this.#open();
		} catch (err) {
			this.#failed(err);
		}
	}

	async #open() {
		this.conversation = await this.#m.family();
		await this.#reload();
		this.phase = 'ready';
		this.#live?.close();
		this.#live = new EventSource('/api/mensajes/vivo');
		this.#live.onmessage = () => void this.refresh();
	}

	/** What came, and the group as it should be (someone's new device, one taken out). */
	async refresh() {
		try {
			await this.#m.sync();
			if (this.conversation) await this.#m.family();
			await this.#reload();
		} catch (err) {
			this.#failed(err);
		}
	}

	async #reload() {
		if (!this.conversation) return;
		this.list = await this.#m.messages(this.conversation);
		const people = await this.#m.people(this.conversation);
		this.alone = people.length <= 1;
	}

	async send(text: string) {
		if (!this.conversation) return;
		this.problem = null;
		try {
			await this.#m.send(this.conversation, text);
			await this.#reload();
		} catch (err) {
			this.problem = err instanceof Error ? err.message : String(err);
		}
	}

	stop() {
		this.#live?.close();
		this.#live = null;
	}

	#failed(err: unknown) {
		this.problem = err instanceof Error ? err.message : String(err);
		// Taken out in Ajustes (from here or another device): its old keys away, to turn them on again.
		if (/no tiene los mensajes activados|ya no puede usarse/.test(this.problem)) {
			this.stop();
			indexedDB.deleteDatabase(`seilide-mensajes-${this.#userId}`);
			this.#m = new Messenger(idbStore(this.#userId), httpTransport, this.#userId);
			this.problem = 'Este aparato se quitó de los mensajes: actívalo de nuevo para seguir.';
			this.phase = 'off';
			return;
		}
		this.phase = this.phase === 'loading' ? 'failed' : this.phase;
	}
}
