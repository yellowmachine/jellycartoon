import { music } from 'comun/music-player.svelte.ts';
import { Messenger, describe, type StoredMessage } from './messenger.ts';
import { idbStore } from './idb-store.ts';
import { httpTransport } from './http-transport.ts';
import { lockFor } from './lock.ts';
import { VoiceRecorder } from './recorder.svelte.ts';
import type { BackupStore } from './backup.ts';

/**
 * Mensajes (#551) by voice, in this device: the ones that come read aloud (in the road mode, if
 * asked), a voice message recorded apart from the order and sent with a «sí», and «¿tengo mensajes?».
 * What they say is encrypted and decrypted here: the voice's AI only says what to do.
 */

/** Longer than this, an audio is announced, and played when asked («pon el audio»). */
const PLAY_AT_ONCE_S = 60;
const READ_KEY = 'seilide:mensajes-en-voz-alta';
const AS_KEY = 'seilide:mensajes-voz-como';

export type SendAs = 'audio' | 'texto' | 'ambos';

const stored = (key: string) => {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
};
const keep = (key: string, value: string | null) => {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Private window: only forgotten.
	}
};

/** Said aloud over the music lowered, and waited for. */
export function say(text: string): Promise<void> {
	return new Promise((resolve) => {
		if (!('speechSynthesis' in globalThis)) return resolve();
		const u = new SpeechSynthesisUtterance(text);
		u.lang = 'es-ES';
		music.duck(true);
		const end = () => {
			if (!speechSynthesis.speaking) music.duck(false);
			resolve();
		};
		u.onend = end;
		u.onerror = end;
		speechSynthesis.speak(u);
	});
}

/**
 * The voice's own answer said first («Dime el mensaje», «Te los leo»): what the device says or
 * records starts when it is quiet, or it would cut it, or record it.
 */
async function quiet(maxMs = 10_000) {
	if (!('speechSynthesis' in globalThis)) return;
	await new Promise((r) => setTimeout(r, 400));
	const until = Date.now() + maxMs;
	while (speechSynthesis.speaking && Date.now() < until)
		await new Promise((r) => setTimeout(r, 150));
}

/** A voice note played here (decrypted), over the music lowered, and waited for. */
function play(blob: Blob): Promise<void> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(blob);
		const a = new Audio(url);
		music.duck(true);
		const end = () => {
			music.duck(false);
			URL.revokeObjectURL(url);
			resolve();
		};
		a.onended = end;
		a.onerror = end;
		void a.play().catch(end);
	});
}

interface Pending {
	conversationId: string;
	name: string;
	blob: Blob;
	seconds: number;
	transcript: string | null;
}

class MessagesVoice {
	/** This device has messages on (its keys here). */
	active = $state(false);
	/** «Léeme los mensajes que lleguen»: on this device. */
	readAloud = $state(stored(READ_KEY) === 'on');
	sendAs = $state<SendAs>((stored(AS_KEY) as SendAs) ?? 'audio');
	/** Recorded, waiting for its «sí». */
	pending = $state<Pending | null>(null);
	recording = $state(false);
	busy = $state<string | null>(null);
	/** The last ones read aloud here, newest first (the road mode's list). */
	heard = $state<{ name: string; text: string; at: string }[]>([]);
	#m: Messenger | null = null;
	#userId = '';
	#names: Record<string, string> = {};
	#seen = new Set<string>();
	#live: EventSource | null = null;
	#longAudio: StoredMessage | null = null;
	#recorder = new VoiceRecorder();

	/** For this person, in this device: whether messages are on here. */
	async init(userId: string) {
		if (this.#userId !== userId || !this.#m) {
			this.#userId = userId;
			const store: BackupStore = idbStore(userId);
			this.#m = new Messenger(store, httpTransport, userId, undefined, lockFor(userId));
		}
		// Asked again each time: turned on (or taken out) since.
		this.active = Boolean(await this.#m.device());
		return this.active;
	}

	setReadAloud(on: boolean) {
		this.readAloud = on;
		keep(READ_KEY, on ? 'on' : null);
	}

	setSendAs(as: SendAs) {
		this.sendAs = as;
		keep(AS_KEY, as);
	}

	async #nameOf(userId: string) {
		if (!this.#names[userId])
			this.#names = await fetch('/api/mensajes', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'nombres' })
			})
				.then((r) => (r.ok ? r.json() : {}))
				.catch(() => ({}));
		return this.#names[userId] ?? 'Alguien';
	}

	/** Every message here now, of every conversation. */
	async #all() {
		const m = this.#m!;
		const list = await m.lookAll().catch(() => []);
		const all: StoredMessage[] = [];
		for (const c of list) all.push(...(await m.messages(c.id)));
		return all;
	}

	/** While on (the road mode): each one that comes, read aloud; voice notes played. */
	async listen() {
		if (!this.active || !this.#m || this.#live) return;
		for (const m of await this.#all()) this.#seen.add(`${m.conversationId}/${m.key}`);
		this.#live = new EventSource('/api/mensajes/vivo');
		this.#live.onmessage = () => void this.#news();
	}

	stopListening() {
		this.#live?.close();
		this.#live = null;
	}

	async #news() {
		if (!this.#m) return;
		await this.#m.sync().catch(() => 0);
		for (const m of await this.#all()) {
			const id = `${m.conversationId}/${m.key}`;
			if (this.#seen.has(id)) continue;
			this.#seen.add(id);
			if (m.mine || !this.readAloud) continue;
			await this.#announce(m);
		}
	}

	async #announce(m: StoredMessage) {
		const name = await this.#nameOf(m.userId);
		if (m.photo || m.place) {
			this.heard = [{ name, text: describe(m), at: m.at }, ...this.heard].slice(0, 20);
			return say(`${name} te manda ${m.photo ? 'una foto' : 'su ubicación'}.`);
		}
		if (!m.audio) {
			this.heard = [{ name, text: m.text, at: m.at }, ...this.heard].slice(0, 20);
			return say(`${name}: ${m.text}`);
		}
		this.heard = [{ name, text: m.transcript ?? '🎤 Audio', at: m.at }, ...this.heard].slice(0, 20);
		if (m.audio.seconds > PLAY_AT_ONCE_S) {
			this.#longAudio = m;
			return say(
				`${name} te manda un audio de ${Math.round(m.audio.seconds / 60)} minutos. Di «pon el audio» para oírlo.`
			);
		}
		await say(`${name} te manda un audio.`);
		await play(await this.#m!.audio(m));
	}

	/** «¿Tengo mensajes?»: those not read in this device since it last looked, aloud. */
	async readUnread() {
		if (!this.#m) return;
		await quiet();
		await this.#m.sync().catch(() => 0);
		const fresh = (await this.#all()).filter(
			(m) => !m.mine && !this.#seen.has(`${m.conversationId}/${m.key}`)
		);
		if (!fresh.length) return say('No tienes mensajes nuevos.');
		for (const m of fresh.sort((a, b) => a.at.localeCompare(b.at))) {
			this.#seen.add(`${m.conversationId}/${m.key}`);
			await this.#announce(m);
		}
	}

	/** «Pon el audio»: the long one announced. */
	async playLong() {
		const m = this.#longAudio;
		this.#longAudio = null;
		await quiet();
		if (m && this.#m) await play(await this.#m.audio(m));
	}

	/**
	 * «Mándale un mensaje a papá»: «Dime el mensaje», recorded until a silence, its text made here if
	 * it is to go as text, and asked for its «sí».
	 */
	async record(to: string, name: string) {
		if (!this.#m) return;
		this.pending = null;
		try {
			this.busy = 'Preparando…';
			const conversationId = to === 'familia' ? await this.#m.family() : await this.#m.pair(to);
			this.busy = null;
			// The voice has just said «Dime el mensaje para…»: recorded once it is quiet.
			await quiet();
			this.recording = true;
			const got = await this.#recorder.untilSilence(60);
			this.recording = false;
			if (!got) return say('No te he oído. No se manda nada.');
			let transcript: string | null = null;
			if (this.sendAs !== 'audio') {
				this.busy = 'Escribiendo lo que has dicho…';
				const { transcriber } = await import('./transcriber.svelte.ts');
				transcript = await transcriber.text(got.blob).catch(() => null);
				this.busy = null;
			}
			this.pending = { conversationId, name, blob: got.blob, seconds: got.seconds, transcript };
			await say(
				transcript
					? `Le mando a ${name}: ${transcript}. ¿Lo mando?`
					: `¿Le mando el audio a ${name}?`
			);
		} catch (err) {
			this.recording = false;
			this.busy = null;
			await say(`No se ha podido: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** Its «sí» (or «no»): sent as this device sends them, or dropped. */
	async answer(send: boolean) {
		const p = this.pending;
		this.pending = null;
		if (!p || !this.#m) return;
		if (!send) return;
		const bytes = new Uint8Array(await p.blob.arrayBuffer());
		if (this.sendAs === 'texto' && p.transcript) await this.#m.send(p.conversationId, p.transcript);
		else
			await this.#m.sendAudio(
				p.conversationId,
				bytes,
				p.blob.type,
				p.seconds,
				this.sendAs === 'ambos' ? (p.transcript ?? undefined) : undefined
			);
	}
}

export const messagesVoice = new MessagesVoice();
