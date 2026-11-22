import {
	acceptAll,
	createApplicationMessage,
	createCommit,
	createGroup,
	decodeGroupState,
	decodeMlsMessage,
	defaultCapabilities,
	defaultLifetime,
	emptyPskIndex,
	encodeGroupState,
	encodeMlsMessage,
	generateKeyPackage,
	generateKeyPackageWithKey,
	getCiphersuiteFromName,
	getCiphersuiteImpl,
	joinGroup,
	processMessage,
	zeroOutUint8Array,
	type CiphersuiteImpl,
	type ClientConfig,
	type ClientState,
	type Credential,
	type KeyPackage,
	type PrivateKeyPackage,
	type Proposal
} from 'ts-mls';
import { parseRecipe, type Recipe } from 'comun/recipe.ts';
import { citaWhen, parseCita, type Cita } from '#lib/cita.ts';

/**
 * Mensajes (#551) in a device: its MLS keys, its groups and what was said in them, end to end. The
 * server (messages-scope.ts) only hands out key packages and encrypted events in order; everything
 * is encrypted and decrypted here. Apart from the browser (`Store`, `Transport`), to be tested in Bun.
 */

export const SUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';
/** Key packages a device keeps on the server: one is used each time a group adds it. */
const KEY_PACKAGES = 20;
const REFILL_BELOW = 8;
export const MAX_TEXT = 4000;

export interface DeviceKeys {
	id: string;
	userId: string;
	name: string;
	signKey: Uint8Array;
	signPublic: Uint8Array;
}

/** A key package's private half, kept until a welcome uses it. */
export interface PrivatePackage {
	public: Uint8Array;
	private: PrivateKeyPackage;
}

export interface StoredMessage {
	conversationId: string;
	/** The event's id, or the local one of what this device sent, until it comes back. */
	key: string;
	userId: string;
	deviceId: string;
	text: string;
	at: string;
	mine: boolean;
	/** A voice note: its encrypted file in the family's storage, and its key (only here). */
	audio?: AudioMeta;
	/** A voice note's text, made in a device of this person's (never sent). */
	transcript?: string;
	/** A photo (#555): its encrypted file, as a voice note's. */
	photo?: PhotoMeta;
	/** Where someone was when sending it (#555). */
	place?: Place;
	/** A recipe or a list the AI made for it (#555), to take with a touch. */
	card?: MessageCard;
}

export type MessageCard =
	| { kind: 'receta'; recipe: Recipe }
	| { kind: 'compra'; items: string[] }
	/** One already in the family's book, to someone of the same family: only which (#555). */
	| { kind: 'enlace-receta'; id: number; title: string }
	/** A plan, to add to the Agenda. */
	| ({ kind: 'cita' } & Cita)
	/** A place kept by the sender (#151): to go there, or keep it too (each person's own). */
	| { kind: 'sitio'; name: string; lat: number; lon: number; address: string | null }
	/**
	 * A link with what its page says (#586): read by the sender's Seilide before it goes, so the
	 * message stays encrypted; its picture shown from the shop.
	 */
	| {
			kind: 'enlace';
			url: string;
			title: string;
			shop: string;
			imageUrl: string | null;
			price: string | null;
	  };

/**
 * A recipe of the book, as it goes in a message (#555): within the family, referred (the book is
 * everyone's: only which one); to a linked family, copied whole, for them to keep their own.
 */
export const bookRecipeCard = (
	saved: { id: number; recipe: Recipe },
	sameFamily: boolean
): MessageCard =>
	sameFamily
		? { kind: 'enlace-receta', id: saved.id, title: saved.recipe.title }
		: { kind: 'receta', recipe: saved.recipe };
/** Things in a list, at most (as the AI's cards). */
const MAX_CARD_ITEMS = 30;

/** A file of a message, encrypted in the device: in the family's storage, and its key (only here). */
export interface FileMeta {
	file: string;
	/** AES-256-GCM's, base64. */
	key: string;
	iv: string;
	mime: string;
}

export interface AudioMeta extends FileMeta {
	seconds: number;
}

export interface PhotoMeta extends FileMeta {
	width: number;
	height: number;
}

export interface Place {
	lat: number;
	lon: number;
	/** How sure the device was, in metres. */
	accuracy?: number;
}

/** What a message is, in a few words: for a list, a notice or the voice. */
export function describe(m: Pick<StoredMessage, 'text' | 'audio' | 'photo' | 'place' | 'card'>) {
	if (m.audio)
		return `🎤 Audio (${Math.floor(m.audio.seconds / 60)}:${String(m.audio.seconds % 60).padStart(2, '0')})`;
	if (m.photo) return '📷 Foto';
	if (m.place) return '📍 Ubicación';
	if (m.card?.kind === 'receta') return `🍰 Receta: ${m.card.recipe.title}`;
	if (m.card?.kind === 'enlace-receta') return `🍰 Receta: ${m.card.title}`;
	if (m.card?.kind === 'cita') return `📅 ${m.card.title}, ${citaWhen(m.card)}`;
	if (m.card?.kind === 'sitio') return `📌 ${m.card.name}`;
	if (m.card?.kind === 'compra') return `🛒 Lista (${m.card.items.length})`;
	if (m.card?.kind === 'enlace') return `🔗 ${m.card.title}`;
	return m.text;
}

export interface Store {
	device(): Promise<DeviceKeys | null>;
	setDevice(d: DeviceKeys): Promise<void>;
	packages(): Promise<PrivatePackage[]>;
	setPackages(p: PrivatePackage[]): Promise<void>;
	group(conversationId: string): Promise<Uint8Array | null>;
	setGroup(conversationId: string, state: Uint8Array): Promise<void>;
	/** A group of its own nobody else has (another device's became the conversation's). */
	removeGroup(conversationId: string): Promise<void>;
	cursor(): Promise<number>;
	setCursor(n: number): Promise<void>;
	addMessage(m: StoredMessage): Promise<void>;
	messages(conversationId: string): Promise<StoredMessage[]>;
}

export interface ConversationView {
	id: string;
	kind: 'familia' | 'pareja';
	epoch: number;
	devices: { deviceId: string; userId: string }[];
}

export interface EventIn {
	id: number;
	conversationId: string;
	kind: 'welcome' | 'commit' | 'app';
	epoch: number;
	senderDevice: string;
	data: string;
	at: string;
}

/** What the server does for the device (messages-scope.ts, through /api/mensajes). */
export interface Transport {
	register(d: {
		id: string;
		name: string;
		keyPackages: string[];
	}): Promise<{ keyPackages: number }>;
	familyConversation(deviceId: string): Promise<ConversationView & { created: boolean }>;
	pairConversation(deviceId: string, otherId: string): Promise<ConversationView>;
	conversations(
		deviceId: string
	): Promise<{ id: string; kind: 'familia' | 'pareja'; with: string | null }[]>;
	conversation(deviceId: string, id: string): Promise<ConversationView>;
	claim(
		deviceId: string,
		conversationId: string,
		deviceIds: string[]
	): Promise<Record<string, string>>;
	commit(
		deviceId: string,
		c: {
			conversationId: string;
			epoch: number;
			commit: string;
			welcome?: string;
			recipients?: string[];
		}
	): Promise<{ ok: boolean; epoch: number }>;
	/** `stale`: made on an epoch the group has left; caught up and made again. */
	send(
		deviceId: string,
		m: { conversationId: string; epoch: number; data: string }
	): Promise<{ id: number; stale?: boolean }>;
	events(deviceId: string, since: number): Promise<EventIn[]>;
	/** A file of a message (a voice note, a photo), already encrypted. */
	uploadFile(deviceId: string, conversationId: string, sealed: Uint8Array): Promise<{ id: string }>;
	downloadFile(conversationId: string, file: string): Promise<Uint8Array>;
}

const te = new TextEncoder();
const td = new TextDecoder();

export function toB64(bytes: Uint8Array) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const identityOf = (userId: string, deviceId: string) => `${userId}/${deviceId}`;
const splitIdentity = (identity: string) => {
	const at = identity.lastIndexOf('/');
	return { userId: identity.slice(0, at), deviceId: identity.slice(at + 1) };
};

/** The group's members now, by their MLS identity, with their leaf in its tree. */
export function membersOf(state: ClientState) {
	const out: { identity: string; leaf: number }[] = [];
	state.ratchetTree.forEach((node, i) => {
		// Leaves are the even nodes of the tree.
		if (i % 2 !== 0 || !node || node.nodeType !== 'leaf') return;
		const cred = node.leaf.credential;
		if (cred.credentialType === 'basic')
			out.push({ identity: td.decode(cred.identity), leaf: i / 2 });
	});
	return out;
}

const epochOf = (s: ClientState) => Number(s.groupContext.epoch);

export class Messenger {
	#impl: CiphersuiteImpl | null = null;
	/** Identities the server says are in the conversations seen: only those are let into a group. */
	#known = new Set<string>();
	#config: ClientConfig | null = null;
	#busy: Promise<unknown> = Promise.resolve();

	constructor(
		private store: Store,
		private transport: Transport,
		private userId: string,
		private newId: () => string = () => crypto.randomUUID(),
		/**
		 * Held while a group is touched, across the page and its service worker (Web Locks), which
		 * both read and keep the same groups: one at a time, or one would write over the other's.
		 */
		private lock: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn()
	) {}

	async #cs() {
		this.#impl ??= await getCiphersuiteImpl(getCiphersuiteFromName(SUITE));
		return this.#impl;
	}

	/** ts-mls' defaults (its own, not exported), with who may be in a group: the server's devices. */
	#cfg(): ClientConfig {
		this.#config ??= {
			keyRetentionConfig: {
				retainKeysForGenerations: 10,
				retainKeysForEpochs: 4,
				maximumForwardRatchetSteps: 200
			},
			lifetimeConfig: { maximumTotalLifetime: 2628000n, validateLifetimeOnReceive: false },
			keyPackageEqualityConfig: {
				compareKeyPackages: (a, b) =>
					same(a.leafNode.signaturePublicKey, b.leafNode.signaturePublicKey),
				compareKeyPackageToLeafNode: (a, b) =>
					same(a.leafNode.signaturePublicKey, b.signaturePublicKey)
			},
			paddingConfig: { kind: 'padUntilLength', padUntilLength: 256 },
			authService: {
				validateCredential: async (cred) =>
					cred.credentialType === 'basic' && this.#known.has(td.decode(cred.identity))
			}
		};
		return this.#config;
	}

	/** One thing at a time: a sync and a send never touch a group at once. */
	#serial<T>(fn: () => Promise<T>): Promise<T> {
		const locked = () => this.lock(fn);
		const run = this.#busy.then(locked, locked);
		this.#busy = run.catch(() => {});
		return run;
	}

	async device() {
		return this.store.device();
	}

	/** Messages on in this device: its keys made here, the public halves to the server. */
	async setup(name: string) {
		return this.#serial(async () => {
			let d = await this.store.device();
			if (!d) {
				const cs = await this.#cs();
				const id = this.newId();
				const first = await generateKeyPackage(
					this.#credential(id),
					defaultCapabilities(),
					defaultLifetime,
					[],
					cs
				);
				d = {
					id,
					userId: this.userId,
					name,
					signKey: first.privatePackage.signaturePrivateKey,
					signPublic: first.publicPackage.leafNode.signaturePublicKey
				};
				await this.store.setDevice(d);
				await this.store.setPackages([
					{ public: encodePackage(first.publicPackage), private: first.privatePackage }
				]);
			}
			await this.#refill(d, true);
			return d;
		});
	}

	#credential(deviceId: string): Credential {
		return { credentialType: 'basic', identity: te.encode(identityOf(this.userId, deviceId)) };
	}

	/** Enough key packages on the server for the groups that may add this device. */
	async #refill(d: DeviceKeys, always = false) {
		const kept = await this.store.packages();
		const fresh: PrivatePackage[] = [];
		if (always || kept.length < REFILL_BELOW) {
			const cs = await this.#cs();
			for (let i = kept.length; i < KEY_PACKAGES; i++) {
				const kp = await generateKeyPackageWithKey(
					this.#credential(d.id),
					defaultCapabilities(),
					defaultLifetime,
					[],
					{ signKey: d.signKey, publicKey: d.signPublic },
					cs
				);
				fresh.push({ public: encodePackage(kp.publicPackage), private: kp.privatePackage });
			}
		}
		const all = [...kept, ...fresh];
		await this.store.setPackages(all);
		// The server keeps what it has not handed out; on setup, all of them again.
		await this.transport.register({
			id: d.id,
			name: d.name,
			keyPackages: (always ? all : fresh).map((p) => toB64(p.public))
		});
	}

	async #load(conversationId: string): Promise<ClientState | null> {
		const bytes = await this.store.group(conversationId);
		if (!bytes) return null;
		const decoded = decodeGroupState(bytes, 0);
		return decoded ? { ...decoded[0], clientConfig: this.#cfg() } : null;
	}

	#save(conversationId: string, s: ClientState) {
		return this.store.setGroup(conversationId, encodeGroupState(s));
	}

	#learn(view: ConversationView) {
		for (const d of view.devices) this.#known.add(identityOf(d.userId, d.deviceId));
	}

	/**
	 * The family's conversation: its group made here if nobody has made it yet, then read up to date
	 * and its members as the server says (devices added and taken out).
	 */
	async family() {
		const d = await this.#need();
		const view = await this.transport.familyConversation(d.id);
		this.#learn(view);
		await this.sync();
		await this.#serial(() => this.#reconcile(d, view.id));
		return view.id;
	}

	/** Two people's conversation, made the first time (in both families, if linked ones). */
	async pair(otherId: string) {
		const d = await this.#need();
		const view = await this.transport.pairConversation(d.id, otherId);
		this.#learn(view);
		await this.sync();
		await this.#serial(() => this.#reconcile(d, view.id));
		return view.id;
	}

	/**
	 * Every conversation this person is in, each group as the server says it should be (a new device
	 * in, a lost one out; a two people's one made by the other, joined): what there is, to list.
	 */
	async lookAll() {
		const d = await this.#need();
		await this.sync();
		const list = await this.transport.conversations(d.id);
		for (const c of list) await this.#serial(() => this.#reconcile(d, c.id));
		return list;
	}

	async #need() {
		const d = await this.store.device();
		if (!d) throw new Error('Este aparato no tiene los mensajes activados');
		return d;
	}

	/** What came since the last time, in order: the welcomes that add this device, changes, messages. */
	async sync() {
		const d = await this.#need();
		return this.#serial(async () => {
			let got = 0;
			for (;;) {
				const since = await this.store.cursor();
				const events = await this.transport.events(d.id, since);
				if (!events.length) break;
				for (const ev of events) {
					const stop = await this.#apply(d, ev);
					if (stop) return got;
					await this.store.setCursor(ev.id);
					got++;
				}
			}
			await this.#refillIfLow(d);
			return got;
		});
	}

	async #refillIfLow(d: DeviceKeys) {
		if ((await this.store.packages()).length < REFILL_BELOW) await this.#refill(d);
	}

	/** True: stop here and try again later (a message of an epoch not reached yet). */
	async #apply(d: DeviceKeys, ev: EventIn): Promise<boolean> {
		const cs = await this.#cs();
		const state = await this.#load(ev.conversationId);
		if (ev.kind === 'welcome') {
			// For a device without its group yet, or with one nobody else has (its epoch 0).
			if (state && epochOf(state) > 0) return false;
			await this.#refreshKnown(d, ev.conversationId);
			const msg = decodeMlsMessage(fromB64(ev.data), 0)?.[0];
			if (!msg || msg.wireformat !== 'mls_welcome') return false;
			const packages = await this.store.packages();
			for (const [i, p] of packages.entries()) {
				const pub = decodePackage(p.public);
				if (!pub) continue;
				try {
					const joined = await joinGroup(
						msg.welcome,
						pub,
						p.private,
						emptyPskIndex,
						cs,
						undefined,
						undefined,
						this.#cfg()
					);
					await this.#save(ev.conversationId, joined);
					await this.store.setPackages(packages.filter((_, j) => j !== i));
					return false;
				} catch {
					// Not this one's.
				}
			}
			return false;
		}
		if (!state) return false; // Before this device was in it: not its own.
		if (ev.senderDevice === d.id) return false; // Applied, or kept, when it was sent.
		const current = epochOf(state);
		// Another device's group won at epoch 0: this one's, alone, is not the conversation's. Its
		// welcome comes next (if this device is in it), or the next look adds it.
		if (ev.kind === 'commit' && ev.epoch === 0 && current === 0) {
			await this.store.removeGroup(ev.conversationId);
			return false;
		}
		if (ev.epoch < current) return false;
		if (ev.epoch > current) return true;
		const msg = decodeMlsMessage(fromB64(ev.data), 0)?.[0];
		if (
			!msg ||
			(msg.wireformat !== 'mls_private_message' && msg.wireformat !== 'mls_public_message')
		)
			return false;
		if (ev.kind === 'commit') await this.#refreshKnown(d, ev.conversationId);
		try {
			const r = await processMessage(msg as never, state, emptyPskIndex, acceptAll, cs);
			r.consumed.forEach(zeroOutUint8Array);
			await this.#save(ev.conversationId, r.newState);
			if (r.kind === 'applicationMessage') {
				const body = parseBody(td.decode(r.message));
				// Who wrote it, as it says inside (encrypted), must be the device the server saw send it
				// (by its session): neither the server alone nor another member can pass for someone.
				const seen = senderIdentity(state, ev.senderDevice);
				if (body && body.from !== seen) {
					console.warn('[mensajes] Remitente que no cuadra: no se muestra', ev.id);
					return false;
				}
				const from = splitIdentity(body?.from ?? `?/${ev.senderDevice}`);
				if (body)
					await this.store.addMessage({
						conversationId: ev.conversationId,
						key: String(ev.id),
						userId: from.userId,
						deviceId: ev.senderDevice,
						text: body.text,
						at: ev.at,
						mine: from.userId === this.userId,
						...extras(body)
					});
			}
		} catch (err) {
			console.warn('[mensajes] No se ha podido leer un evento', ev.id, err);
		}
		return false;
	}

	async #refreshKnown(d: DeviceKeys, conversationId: string) {
		this.#learn(await this.transport.conversation(d.id, conversationId));
	}

	/**
	 * The group as the server says it should be: the devices missing, added (each with one of its key
	 * packages); those revoked or gone, taken out. If another device changed it first, caught up and
	 * tried again.
	 */
	async #reconcile(d: DeviceKeys, conversationId: string, tries = 3): Promise<void> {
		const cs = await this.#cs();
		const view = await this.transport.conversation(d.id, conversationId);
		this.#learn(view);
		let state = await this.#load(conversationId);
		// A group of its own left behind: the conversation's is another one, which will add this device.
		if (state && epochOf(state) === 0 && view.epoch > 0) {
			await this.store.removeGroup(conversationId);
			state = null;
		}
		if (!state) {
			// Nobody has made its group yet (or it was this device, and it is alone): made here.
			if (view.epoch > 0) return; // Its welcome will come.
			// With a key package of its own, never one on the server (another device may be handed it).
			const own = await generateKeyPackageWithKey(
				this.#credential(d.id),
				defaultCapabilities(),
				defaultLifetime,
				[],
				{ signKey: d.signKey, publicKey: d.signPublic },
				cs
			);
			state = await createGroup(
				te.encode(conversationId),
				own.publicPackage,
				own.privatePackage,
				[],
				cs,
				this.#cfg()
			);
			await this.#save(conversationId, state);
		}
		const members = membersOf(state);
		const want = new Set(view.devices.map((v) => identityOf(v.userId, v.deviceId)));
		const have = new Set(members.map((m) => m.identity));
		const toAdd = view.devices.filter((v) => !have.has(identityOf(v.userId, v.deviceId)));
		const toRemove = members.filter((m) => !want.has(m.identity));
		if (!toAdd.length && !toRemove.length) return;
		const packages = toAdd.length
			? await this.transport.claim(
					d.id,
					conversationId,
					toAdd.map((a) => a.deviceId)
				)
			: {};
		const proposals: Proposal[] = [];
		const added: string[] = [];
		for (const [deviceId, data] of Object.entries(packages)) {
			const kp = decodePackage(fromB64(data));
			if (kp) {
				proposals.push({ proposalType: 'add', add: { keyPackage: kp } });
				added.push(deviceId);
			}
		}
		for (const r of toRemove)
			proposals.push({ proposalType: 'remove', remove: { removed: r.leaf } });
		if (!proposals.length) return;
		const epoch = epochOf(state);
		const c = await createCommit(
			{ state, cipherSuite: cs },
			{ extraProposals: proposals, ratchetTreeExtension: true }
		);
		const answer = await this.transport.commit(d.id, {
			conversationId,
			epoch,
			commit: toB64(encodeMlsMessage(c.commit)),
			...(c.welcome
				? {
						welcome: toB64(
							encodeMlsMessage({ welcome: c.welcome, wireformat: 'mls_welcome', version: 'mls10' })
						),
						recipients: added
					}
				: {})
		});
		if (answer.ok) {
			c.consumed.forEach(zeroOutUint8Array);
			await this.#save(conversationId, c.newState);
			return;
		}
		// Changed first by another device: read up to it and look again.
		if (tries > 0) {
			await this.#syncUnlocked(d);
			return this.#reconcile(d, conversationId, tries - 1);
		}
	}

	async #syncUnlocked(d: DeviceKeys) {
		for (;;) {
			const events = await this.transport.events(d.id, await this.store.cursor());
			if (!events.length) return;
			for (const ev of events) {
				if (await this.#apply(d, ev)) return;
				await this.store.setCursor(ev.id);
			}
		}
	}

	/** A text to a conversation: encrypted here, kept here as said. */
	async send(conversationId: string, text: string) {
		const clean = text.trim().slice(0, MAX_TEXT);
		if (!clean) return null;
		return this.#post(conversationId, { t: 'texto', text: clean }, { text: clean });
	}

	/**
	 * A voice note: encrypted here with a key of its own, uploaded as it is (Seilide cannot open it),
	 * and its key in the message, which only those in the conversation read.
	 */
	async sendAudio(
		conversationId: string,
		audio: Uint8Array,
		mime: string,
		seconds: number,
		/** Its text, made in this device, sent with it («los dos»). */
		transcript?: string
	) {
		const meta: AudioMeta = {
			...(await this.#upload(conversationId, audio, mime)),
			seconds: Math.max(1, Math.round(seconds))
		};
		const said = transcript?.trim().slice(0, MAX_TEXT);
		return this.#post(
			conversationId,
			{ t: 'audio', ...meta, ...(said ? { transcript: said } : {}) },
			{ text: '', audio: meta, ...(said ? { transcript: said } : {}) }
		);
	}

	/**
	 * A photo (#555), already made small in the device (which also leaves out what the camera wrote in
	 * it, such as where it was taken): encrypted and uploaded as a voice note.
	 */
	async sendPhoto(
		conversationId: string,
		photo: Uint8Array,
		mime: string,
		width: number,
		height: number
	) {
		const meta: PhotoMeta = {
			...(await this.#upload(conversationId, photo, mime)),
			width: Math.round(width),
			height: Math.round(height)
		};
		return this.#post(conversationId, { t: 'foto', ...meta }, { text: '', photo: meta });
	}

	/** Where this person is (#555): only in the message, encrypted as a text. */
	async sendPlace(conversationId: string, place: Place) {
		const clean = cleanPlace(place);
		if (!clean) throw new Error('Esa posición no vale');
		return this.#post(conversationId, { t: 'ubicacion', ...clean }, { text: '', place: clean });
	}

	/** A recipe or a list (#555), inside the message, encrypted as a text. */
	async sendCard(conversationId: string, card: MessageCard) {
		const clean = cleanCard(card);
		if (!clean) throw new Error('Esa tarjeta no vale');
		return this.#post(conversationId, { t: 'tarjeta', card: clean }, { text: '', card: clean });
	}

	/** Encrypted here with a key of its own and uploaded as it is: Seilide cannot open it. */
	async #upload(conversationId: string, bytes: Uint8Array, mime: string) {
		const d = await this.#need();
		const raw = crypto.getRandomValues(new Uint8Array(32));
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
		const sealed = new Uint8Array(
			await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, Uint8Array.from(bytes))
		);
		const { id } = await this.transport.uploadFile(d.id, conversationId, sealed);
		return { file: id, key: toB64(raw), iv: toB64(iv), mime: mime.slice(0, 80) };
	}

	/** A message's file, downloaded and decrypted here. */
	async #open(conversationId: string, meta: FileMeta): Promise<Blob> {
		const sealed = await this.transport.downloadFile(conversationId, meta.file);
		const key = await crypto.subtle.importKey('raw', fromB64(meta.key), 'AES-GCM', false, [
			'decrypt'
		]);
		const plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: fromB64(meta.iv) },
			key,
			Uint8Array.from(sealed)
		);
		return new Blob([plain], { type: meta.mime });
	}

	/** A voice note's sound, downloaded and decrypted here. */
	async audio(m: StoredMessage): Promise<Blob> {
		if (!m.audio) throw new Error('No es un audio');
		return this.#open(m.conversationId, m.audio);
	}

	/** A photo, downloaded and decrypted here. */
	async photo(m: StoredMessage): Promise<Blob> {
		if (!m.photo) throw new Error('No es una foto');
		return this.#open(m.conversationId, m.photo);
	}

	/** Encrypted to the group, sent, and kept here as said. */
	async #post(conversationId: string, body: object, local: Local) {
		const d = await this.#need();
		return this.#serial(async () => {
			const cs = await this.#cs();
			// Up to date first, and again if the group changed meanwhile: on an epoch it has left,
			// nobody would read it (the server says so: `stale`).
			for (let tries = 0; ; tries++) {
				await this.#syncUnlocked(d);
				const state = await this.#load(conversationId);
				if (!state) throw new Error('Esta conversación todavía no está lista en este aparato');
				const r = await createApplicationMessage(
					state,
					te.encode(JSON.stringify({ ...body, from: identityOf(this.userId, d.id) })),
					cs
				);
				const sent = await this.transport.send(d.id, {
					conversationId,
					epoch: epochOf(state),
					data: toB64(
						encodeMlsMessage({
							privateMessage: r.privateMessage,
							wireformat: 'mls_private_message',
							version: 'mls10'
						})
					)
				});
				if (sent.stale) {
					if (tries < 3) continue;
					throw new Error('La conversación ha cambiado: inténtalo otra vez');
				}
				r.consumed.forEach(zeroOutUint8Array);
				await this.#save(conversationId, r.newState);
				return this.#kept(conversationId, d, sent.id, local);
			}
		});
	}

	/** What this device sent, kept here as said. */
	async #kept(conversationId: string, d: DeviceKeys, id: number, local: Local) {
		const m: StoredMessage = {
			conversationId,
			key: String(id),
			userId: this.userId,
			deviceId: d.id,
			text: local.text,
			at: new Date().toISOString(),
			mine: true,
			...extras(local)
		};
		await this.store.addMessage(m);
		return m;
	}

	/** A voice note's text, kept beside it here (and in the PIN backup). */
	async setTranscript(m: StoredMessage, text: string) {
		await this.store.addMessage({ ...m, transcript: text });
	}

	messages(conversationId: string) {
		return this.store.messages(conversationId);
	}

	/** Who is in its group in this device now (their accounts), to say whether anyone else reads it. */
	async people(conversationId: string) {
		const state = await this.#load(conversationId);
		return state ? [...new Set(membersOf(state).map((m) => splitIdentity(m.identity).userId))] : [];
	}
}

function same(a: Uint8Array, b: Uint8Array) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
	return diff === 0;
}

function encodePackage(kp: KeyPackage) {
	return encodeMlsMessage({ keyPackage: kp, wireformat: 'mls_key_package', version: 'mls10' });
}

function decodePackage(bytes: Uint8Array): KeyPackage | null {
	const m = decodeMlsMessage(bytes, 0)?.[0];
	return m && m.wireformat === 'mls_key_package' ? m.keyPackage : null;
}

/** Who sent it, by their device: its identity in the group as it was. */
function senderIdentity(state: ClientState, deviceId: string) {
	return membersOf(state).find((m) => m.identity.endsWith(`/${deviceId}`))?.identity ?? null;
}

/** What a message says besides its text. */
type Local = Pick<StoredMessage, 'text' | 'audio' | 'transcript' | 'photo' | 'place' | 'card'>;
type Body = Local & { from: string };

/** Only what it has: a message keeps no empty fields. */
function extras(b: Local) {
	return {
		...(b.audio ? { audio: b.audio } : {}),
		...(b.transcript ? { transcript: b.transcript } : {}),
		...(b.photo ? { photo: b.photo } : {}),
		...(b.place ? { place: b.place } : {}),
		...(b.card ? { card: b.card } : {})
	};
}

/** A card that is one: a whole recipe, or a list with something in it. */
function cleanCard(value: unknown): MessageCard | null {
	const c = (value ?? {}) as Record<string, unknown>;
	if (c.kind === 'receta') {
		const recipe = parseRecipe(c.recipe);
		return typeof recipe === 'string' ? null : { kind: 'receta', recipe };
	}
	if (c.kind === 'cita') {
		const cita = parseCita(c);
		return cita ? { kind: 'cita', ...cita } : null;
	}
	if (c.kind === 'sitio') {
		const at = cleanPlace(c);
		const name = typeof c.name === 'string' ? c.name.trim().slice(0, 100) : '';
		const address =
			typeof c.address === 'string' && c.address.trim() ? c.address.trim().slice(0, 200) : null;
		return at && name ? { kind: 'sitio', name, lat: at.lat, lon: at.lon, address } : null;
	}
	if (c.kind === 'enlace-receta') {
		const id = Number(c.id);
		const title = typeof c.title === 'string' ? c.title.trim().slice(0, 100) : '';
		return Number.isInteger(id) && id > 0 && title ? { kind: 'enlace-receta', id, title } : null;
	}
	if (c.kind === 'enlace') {
		const web = (v: unknown) => {
			if (typeof v !== 'string' || v.length > 2000) return null;
			try {
				const u = new URL(v);
				return /^https?:$/.test(u.protocol) ? u.href : null;
			} catch {
				return null;
			}
		};
		const url = web(c.url);
		const title = typeof c.title === 'string' ? c.title.trim().slice(0, 300) : '';
		const shop = typeof c.shop === 'string' ? c.shop.trim().slice(0, 60) : '';
		const price =
			typeof c.price === 'string' && c.price.trim() ? c.price.trim().slice(0, 30) : null;
		return url && title
			? {
					kind: 'enlace',
					url,
					title,
					shop: shop || new URL(url).hostname,
					imageUrl: web(c.imageUrl),
					price
				}
			: null;
	}
	if (c.kind === 'compra' && Array.isArray(c.items)) {
		const items = c.items
			.flatMap((i) => (typeof i === 'string' && i.trim() ? [i.trim().slice(0, 100)] : []))
			.slice(0, MAX_CARD_ITEMS);
		return items.length ? { kind: 'compra', items } : null;
	}
	return null;
}

const isFile = (b: Record<string, unknown>) =>
	typeof b.file === 'string' &&
	typeof b.key === 'string' &&
	typeof b.iv === 'string' &&
	typeof b.mime === 'string';
const fileOf = (b: Record<string, string>): FileMeta => ({
	file: b.file!,
	key: b.key!,
	iv: b.iv!,
	mime: b.mime!.slice(0, 80)
});
const isAudio = (b: Record<string, unknown>) => isFile(b) && typeof b.seconds === 'number';
const isPhoto = (b: Record<string, unknown>) =>
	isFile(b) &&
	Number.isFinite(b.width) &&
	Number.isFinite(b.height) &&
	(b.width as number) > 0 &&
	(b.height as number) > 0;

/** A place that is one: on the Earth, its accuracy if it has a sensible one. */
function cleanPlace(p: { lat?: unknown; lon?: unknown; accuracy?: unknown }): Place | null {
	const { lat, lon, accuracy } = p;
	if (typeof lat !== 'number' || typeof lon !== 'number') return null;
	if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
	const round = (n: number) => Math.round(n * 1e6) / 1e6;
	return {
		lat: round(lat),
		lon: round(lon),
		...(typeof accuracy === 'number' && accuracy >= 0 && accuracy < 1e6
			? { accuracy: Math.round(accuracy) }
			: {})
	};
}

function parseBody(raw: string): Body | null {
	try {
		const b = JSON.parse(raw);
		if (!b || typeof b.from !== 'string') return null;
		if (b.t === 'texto' && typeof b.text === 'string')
			return { text: b.text.slice(0, MAX_TEXT), from: b.from };
		if (b.t === 'audio' && isAudio(b))
			return {
				text: '',
				from: b.from,
				audio: { ...fileOf(b), seconds: b.seconds },
				...(typeof b.transcript === 'string' ? { transcript: b.transcript.slice(0, MAX_TEXT) } : {})
			};
		if (b.t === 'foto' && isPhoto(b))
			return {
				text: '',
				from: b.from,
				photo: { ...fileOf(b), width: Math.round(b.width), height: Math.round(b.height) }
			};
		if (b.t === 'tarjeta') {
			const card = cleanCard(b.card);
			return card ? { text: '', from: b.from, card } : null;
		}
		if (b.t === 'ubicacion') {
			const place = cleanPlace(b);
			return place ? { text: '', from: b.from, place } : null;
		}
		return null;
	} catch {
		return null;
	}
}
