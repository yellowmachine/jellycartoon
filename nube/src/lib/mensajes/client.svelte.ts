import { Messenger, type StoredMessage } from './messenger.ts';
import { BackupKeeper, type BackupStore } from './backup.ts';
import { idbStore } from './idb-store.ts';
import { httpTransport } from './http-transport.ts';
import { httpBackup } from './http-backup.ts';
import { lockFor } from './lock.ts';

/** After something new, the backup is brought up to date this long after, once. */
const SAVE_AFTER_MS = 5000;

export interface Chat {
	id: string;
	kind: 'familia' | 'pareja';
	/** Two people's: the other one. */
	with: string | null;
	last: StoredMessage | null;
	unread: boolean;
}

/** When this device last saw each conversation: what came after, and not its own, is unread. */
const readKey = (userId: string, id: string) => `seilide:mensajes:${userId}:leido:${id}`;
function lastRead(userId: string, id: string) {
	try {
		return localStorage.getItem(readKey(userId, id)) ?? '';
	} catch {
		return '';
	}
}
function markRead(userId: string, id: string, at: string) {
	try {
		localStorage.setItem(readKey(userId, id), at);
	} catch {
		// Private window: only forgotten.
	}
}

/**
 * Mensajes (#551) in this browser: whether this device has them on, its conversations (the family's
 * and two people's) and what was said in them, kept up to date while the page is open («hay algo
 * nuevo», then it asks), and the backup behind the PIN.
 */
export class MessagesClient {
	phase = $state<'loading' | 'off' | 'ready' | 'failed'>('loading');
	problem = $state<string | null>(null);
	/** The family's conversation. */
	family = $state<string | null>(null);
	chats = $state<Chat[]>([]);
	/** The one open; null, the list. */
	current = $state<string | null>(null);
	list = $state<StoredMessage[]>([]);
	/** Nobody else in the open one yet: what is written now, only this person's devices read. */
	alone = $state(false);
	/** Not in the open one's group yet: another device lets it in when it looks. */
	waiting = $state(false);
	backup = $state<{
		backup: boolean;
		here: boolean;
		triesLeft: number;
		updatedAt: string | null;
	} | null>(null);
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
		this.#m = new Messenger(this.#store, httpTransport, userId, undefined, lockFor(userId));
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
		this.family = await this.#m.family();
		await this.#look();
		this.backup = await this.#b.state().catch(() => null);
		this.phase = 'ready';
		this.#live?.close();
		this.#live = new EventSource('/api/mensajes/vivo');
		this.#live.onmessage = () => void this.refresh();
	}

	/** Every conversation looked at (groups as they should be), and the list as it is now. */
	async #look() {
		const listed = await this.#m.lookAll();
		const chats: Chat[] = [];
		for (const c of listed) {
			const all = await this.#m.messages(c.id);
			const last = all.at(-1) ?? null;
			const seen = this.current === c.id ? (last?.at ?? '') : lastRead(this.#userId, c.id);
			chats.push({ ...c, last, unread: all.some((m) => !m.mine && m.at > seen) });
		}
		// The family's first, then the most recent.
		chats.sort((a, b) =>
			a.kind !== b.kind
				? a.kind === 'familia'
					? -1
					: 1
				: (b.last?.at ?? '').localeCompare(a.last?.at ?? '')
		);
		this.chats = chats;
		await this.#reloadCurrent();
	}

	async #reloadCurrent() {
		if (!this.current) return;
		this.list = await this.#m.messages(this.current);
		const people = await this.#m.people(this.current);
		this.waiting = people.length === 0;
		this.alone = people.length === 1;
		const last = this.list.at(-1);
		if (last) markRead(this.#userId, this.current, last.at);
	}

	/** What came, and every group as it should be (someone's new device, one taken out). */
	async refresh() {
		try {
			const got = await this.#m.sync();
			await this.#look();
			if (got) this.#saveSoon();
		} catch (err) {
			this.#failed(err);
		}
	}

	/** A conversation open; null, back to the list. */
	async select(id: string | null) {
		this.current = id;
		this.problem = null;
		this.list = [];
		if (id) {
			await this.#reloadCurrent();
			this.chats = this.chats.map((c) => (c.id === id ? { ...c, unread: false } : c));
		}
	}

	/** Two people's: made the first time, then open. */
	async openWith(userId: string) {
		this.problem = null;
		try {
			const id = await this.#m.pair(userId);
			await this.#look();
			await this.select(id);
		} catch (err) {
			this.problem = err instanceof Error ? err.message : String(err);
		}
	}

	async send(text: string) {
		if (!this.current) return;
		this.problem = null;
		try {
			await this.#m.send(this.current, text);
			await this.#reloadCurrent();
			this.#saveSoon();
		} catch (err) {
			this.problem = err instanceof Error ? err.message : String(err);
		}
	}

	/** A voice note to the open conversation. */
	async sendAudio(blob: Blob, seconds: number) {
		if (!this.current) return;
		this.problem = null;
		try {
			await this.#m.sendAudio(
				this.current,
				new Uint8Array(await blob.arrayBuffer()),
				blob.type,
				seconds
			);
			await this.#reloadCurrent();
			this.#saveSoon();
		} catch (err) {
			this.problem = err instanceof Error ? err.message : String(err);
		}
	}

	/** A voice note's text, made in this device: kept beside it. */
	async transcribe(shown: StoredMessage) {
		// A plain copy: what the page shows is reactive, and IndexedDB keeps only plain objects.
		const m = $state.snapshot(shown) as StoredMessage;
		const { transcriber } = await import('./transcriber.svelte.ts');
		const text = await transcriber.text(await this.#m.audio(m));
		await this.#m.setTranscript(m, text);
		await this.#reloadCurrent();
		this.#saveSoon();
		return text;
	}

	#sounds = new Map<string, string>();
	/** A voice note's sound, downloaded and decrypted here once: its address to play. */
	async sound(m: StoredMessage) {
		let url = this.#sounds.get(m.key);
		if (!url) {
			url = URL.createObjectURL(await this.#m.audio(m));
			this.#sounds.set(m.key, url);
		}
		return url;
	}

	async setPin(pin: string, replace = false) {
		this.problem = null;
		try {
			await this.#b.setPin(pin, replace);
			return true;
		} catch (err) {
			this.problem = err instanceof Error ? err.message : String(err);
			return false;
		} finally {
			this.backup = await this.#b.state().catch(() => null);
		}
	}

	async restore(pin: string) {
		this.problem = null;
		try {
			const n = await this.#b.restore(pin);
			await this.#look();
			return n;
		} catch (err) {
			this.problem = err instanceof Error ? err.message : String(err);
			return null;
		} finally {
			this.backup = await this.#b.state().catch(() => null);
		}
	}

	async forgetPin() {
		this.problem = null;
		try {
			await this.#b.forget();
		} catch (err) {
			this.problem = err instanceof Error ? err.message : String(err);
		} finally {
			this.backup = await this.#b.state().catch(() => null);
		}
	}

	#saveSoon() {
		clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => {
			void this.#b
				.save()
				.catch(() => {})
				.then(async () => (this.backup = await this.#b.state().catch(() => null)));
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
			this.#m = new Messenger(
				this.#store,
				httpTransport,
				this.#userId,
				undefined,
				lockFor(this.#userId)
			);
			this.#b = new BackupKeeper(this.#store, httpBackup, this.#userId);
			this.problem = 'Este aparato se quitó de los mensajes: actívalo de nuevo para seguir.';
			this.phase = 'off';
			return;
		}
		this.phase = this.phase === 'loading' ? 'failed' : this.phase;
	}
}
