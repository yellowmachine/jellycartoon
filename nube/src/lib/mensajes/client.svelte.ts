import { Messenger, type StoredMessage } from './messenger.ts';
import { BackupKeeper, type BackupStore } from './backup.ts';
import { idbStore } from './idb-store.ts';
import { httpTransport } from './http-transport.ts';
import { httpBackup } from './http-backup.ts';

/** After something new, the backup is brought up to date this long after, once. */
const SAVE_AFTER_MS = 5000;

/**
 * Mensajes (#551) in this browser: whether this device has them on, the family's conversation and
 * what was said in it, kept up to date while the page is open («hay algo nuevo», then it asks), and
 * the backup behind the PIN: asked for, brought back in a new device, and kept up to date.
 */
export class MessagesClient {
	phase = $state<'loading' | 'off' | 'ready' | 'failed'>('loading');
	problem = $state<string | null>(null);
	conversation = $state<string | null>(null);
	list = $state<StoredMessage[]>([]);
	/** Nobody else with messages on yet: what is written now, only this person's devices read. */
	alone = $state(false);
	/** Not in the conversation's group yet: another device of the family lets it in when it looks. */
	waiting = $state(false);
	/** The backup: whether there is one, whether this device keeps it, tries left. */
	backup = $state<{
		backup: boolean;
		here: boolean;
		triesLeft: number;
		updatedAt: string | null;
	} | null>(null);
	/** «Ahora no» to bringing it back here. */
	skipped = $state(false);
	#m: Messenger;
	#b: BackupKeeper;
	#store: BackupStore;
	#live: EventSource | null = null;
	#userId: string;
	#saveTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(userId: string) {
		this.#userId = userId;
		this.#store = idbStore(userId);
		this.#m = new Messenger(this.#store, httpTransport, userId);
		this.#b = new BackupKeeper(this.#store, httpBackup, userId);
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
		this.problem = null;
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
		await this.#backupState();
		this.phase = 'ready';
		this.#live?.close();
		this.#live = new EventSource('/api/mensajes/vivo');
		this.#live.onmessage = () => void this.refresh();
		// Open, or back after a cut: what came meanwhile (another device may have let this one in).
		this.#live.onopen = () => void this.refresh();
	}

	async #backupState() {
		this.backup = await this.#b.state().catch(() => null);
	}

	/** What came, and the group as it should be (someone's new device, one taken out). */
	async refresh() {
		try {
			const got = await this.#m.sync();
			if (this.conversation) await this.#m.family();
			await this.#reload();
			if (got) this.#saveSoon();
		} catch (err) {
			this.#failed(err);
		}
	}

	async #reload() {
		if (!this.conversation) return;
		this.list = await this.#m.messages(this.conversation);
		const people = await this.#m.people(this.conversation);
		this.waiting = people.length === 0;
		this.alone = people.length === 1;
	}

	async send(text: string) {
		if (!this.conversation) return;
		this.problem = null;
		try {
			await this.#m.send(this.conversation, text);
			await this.#reload();
			this.#saveSoon();
		} catch (err) {
			this.problem = err instanceof Error ? err.message : String(err);
		}
	}

	/** A PIN for the backup (`replace`: another one instead of the one there was). */
	async setPin(pin: string, replace = false) {
		this.problem = null;
		try {
			await this.#b.setPin(pin, replace);
			await this.#backupState();
			return true;
		} catch (err) {
			this.problem = err instanceof Error ? err.message : String(err);
			await this.#backupState();
			return false;
		}
	}

	/** In a new device: what was said before, from the backup. */
	async restore(pin: string) {
		this.problem = null;
		try {
			const n = await this.#b.restore(pin);
			await this.#reload();
			await this.#backupState();
			return n;
		} catch (err) {
			this.problem = err instanceof Error ? err.message : String(err);
			await this.#backupState();
			return null;
		}
	}

	/** «He olvidado el PIN»: the backup gone, to set a new one with what this device holds. */
	async forgetPin() {
		this.problem = null;
		try {
			await this.#b.forget();
			await this.#backupState();
		} catch (err) {
			this.problem = err instanceof Error ? err.message : String(err);
		}
	}

	#saveSoon() {
		clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => {
			void this.#b
				.save()
				.catch(() => {})
				.then(() => this.#backupState());
		}, SAVE_AFTER_MS);
	}

	stop() {
		this.#live?.close();
		this.#live = null;
		clearTimeout(this.#saveTimer);
	}

	#failed(err: unknown) {
		this.problem = err instanceof Error ? err.message : String(err);
		// Taken out in Ajustes (from here or another device): its old keys away, to turn them on again.
		if (/no tiene los mensajes activados|ya no puede usarse/.test(this.problem)) {
			this.stop();
			indexedDB.deleteDatabase(`seilide-mensajes-${this.#userId}`);
			this.#store = idbStore(this.#userId);
			this.#m = new Messenger(this.#store, httpTransport, this.#userId);
			this.#b = new BackupKeeper(this.#store, httpBackup, this.#userId);
			this.problem = 'Este aparato se quitó de los mensajes: actívalo de nuevo para seguir.';
			this.phase = 'off';
			return;
		}
		this.phase = this.phase === 'loading' ? 'failed' : this.phase;
	}
}
