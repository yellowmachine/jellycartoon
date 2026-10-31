import { eq } from 'drizzle-orm';
import { Api, TelegramClient } from 'telegram';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
import { Logger, LogLevel } from 'telegram/extensions/Logger.js';
import { computeCheck } from 'telegram/Password.js';
import { StringSession } from 'telegram/sessions/index.js';
import { db } from '#lib/server/db/index.ts';
import { telegramAccount } from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';
import { decrypt, encrypt } from '#lib/server/secret-box.ts';
import type { TelegramKind, TelegramMessage } from 'comun/telegram.ts';
import { likeness, words } from '#lib/server/voice/music-search.ts';
import { askCloud, cloudLink } from '#lib/server/kitchen.ts';

/**
 * A person's own Telegram account (#243), with Telegram's user API (MTProto) through GramJS
 * (https://gram.js.org): a bot only sees what is written to it, not what the family sends. Connected
 * once in Ajustes (number, the code Telegram sends, and its password if it has one), its session
 * kept encrypted; then listened to here, and each message that comes passed to that person's
 * phone in the road mode, to be read aloud. Nothing is sent in their name.
 */

/** Only errors in the Registro: GramJS tells every packet otherwise. */
const quiet = () => new Logger(LogLevel.ERROR);
/** Waiting for the code (or the password) this long, at most. */
const LOGIN_MS = 10 * 60_000;
/** Messages kept to be marked read once said: the last few. */
const KEEP_FOR_READ = 50;

/** The accounts being listened to, by the person's id. */
const clients = new Map<string, TelegramClient>();
/** Halfway through connecting: the client that asked for the code, and what it needs to go on. */
const pending = new Map<
	string,
	{
		client: TelegramClient;
		phone: string;
		phoneCodeHash: string;
		apiId: number;
		apiHash: string;
		at: number;
	}
>();
/** Each person's chats Seilide learns from (#331), by id: their names. */
const learning = new Map<string, Map<string, string>>();
/** Shorter than this, nothing to remember («ok», «jaja», «👍»). */
const LEARN_MIN_CHARS = 12;
const RECENT_CHATS = 40;

/** Each person's open road modes. */
const listeners = new Map<string, Set<(message: TelegramMessage) => void>>();
/** What was passed on, to mark it read by its key. */
type Chat = NonNullable<Awaited<ReturnType<Api.Message['getInputChat']>>>;
const sent = new Map<string, { userId: string; chat: Chat; id: number }>();

function client(apiId: number, apiHash: string, session = '') {
	return new TelegramClient(new StringSession(session), apiId, apiHash, {
		connectionRetries: 5,
		baseLogger: quiet()
	});
}

/** The person's road modes, told each message that comes (the server-sent events of /api/telegram). */
export function watchTelegram(userId: string, listener: (message: TelegramMessage) => void) {
	const set = listeners.get(userId) ?? new Set();
	set.add(listener);
	listeners.set(userId, set);
	return () => void set.delete(listener);
}

/** Who is connected, and how; null, nobody. */
export async function telegramOf(userId: string) {
	const [row] = await db
		.select({
			name: telegramAccount.name,
			groups: telegramAccount.groups,
			markRead: telegramAccount.markRead,
			learnChats: telegramAccount.learnChats
		})
		.from(telegramAccount)
		.where(eq(telegramAccount.userId, userId));
	return row ? { ...row, listening: clients.has(userId) } : null;
}

/** Telegram's own errors, said for a person. */
function said(err: unknown) {
	const code =
		err instanceof Error ? (err as Error & { errorMessage?: string }).errorMessage : null;
	switch (code) {
		case 'PHONE_NUMBER_INVALID':
			return 'Ese número no vale: con el prefijo, +34…';
		case 'PHONE_CODE_INVALID':
			return 'El código no es ese';
		case 'PHONE_CODE_EXPIRED':
			return 'El código ha caducado: pide otro';
		case 'PASSWORD_HASH_INVALID':
			return 'La contraseña no es esa';
		case 'API_ID_INVALID':
			return 'El api_id o el api_hash no valen: cópialos otra vez de my.telegram.org';
		case 'FLOOD_WAIT':
		case null:
		case undefined:
			break;
		default:
			if (code.startsWith('FLOOD_WAIT')) return 'Demasiados intentos: espera un rato';
	}
	return `Telegram: ${err instanceof Error ? err.message : String(err)}`;
}

/** First step: Telegram sends a code to the account's app (or by SMS). */
export async function sendCode(userId: string, apiId: number, apiHash: string, phone: string) {
	await pending
		.get(userId)
		?.client.disconnect()
		.catch(() => {});
	const c = client(apiId, apiHash);
	try {
		await c.connect();
		const { phoneCodeHash } = await c.sendCode({ apiId, apiHash }, phone);
		pending.set(userId, { client: c, phone, phoneCodeHash, apiId, apiHash, at: Date.now() });
	} catch (err) {
		await c.disconnect().catch(() => {});
		throw new Error(said(err), { cause: err });
	}
}

function stillPending(userId: string) {
	const p = pending.get(userId);
	if (!p || Date.now() - p.at > LOGIN_MS) {
		pending.delete(userId);
		throw new Error('Empieza otra vez: ha pasado mucho rato');
	}
	return p;
}

/** Second step: the code. `password` if the account asks for its password too (two steps). */
export async function checkCode(userId: string, code: string): Promise<'ok' | 'password'> {
	const p = stillPending(userId);
	try {
		await p.client.invoke(
			new Api.auth.SignIn({ phoneNumber: p.phone, phoneCodeHash: p.phoneCodeHash, phoneCode: code })
		);
	} catch (err) {
		if ((err as { errorMessage?: string }).errorMessage === 'SESSION_PASSWORD_NEEDED')
			return 'password';
		throw new Error(said(err), { cause: err });
	}
	await connected(userId);
	return 'ok';
}

/** Its two-step password, the last step. */
export async function checkPassword(userId: string, password: string) {
	const p = stillPending(userId);
	try {
		const asked = await p.client.invoke(new Api.account.GetPassword());
		await p.client.invoke(
			new Api.auth.CheckPassword({ password: await computeCheck(asked, password) })
		);
	} catch (err) {
		throw new Error(said(err), { cause: err });
	}
	await connected(userId);
}

/** In: its session kept, encrypted, and listened to from now on. */
async function connected(userId: string) {
	const p = pending.get(userId)!;
	pending.delete(userId);
	const me = (await p.client.getMe()) as Api.User;
	const name = [me.firstName, me.lastName].filter(Boolean).join(' ') || null;
	const session = (p.client.session as StringSession).save();
	const values = {
		apiId: p.apiId,
		apiHash: encrypt(p.apiHash),
		session: encrypt(session),
		name
	};
	await db
		.insert(telegramAccount)
		.values({ userId, ...values })
		.onConflictDoUpdate({ target: telegramAccount.userId, set: values });
	log.info('telegram', `Cuenta conectada: ${name ?? 'sin nombre'}`, { userId });
	await stop(userId);
	listen(userId, p.client);
}

/** Out: its session closed in Telegram too, and forgotten here. */
export async function disconnect(userId: string) {
	const c = clients.get(userId);
	await c?.invoke(new Api.auth.LogOut()).catch(() => {});
	await stop(userId);
	await db.delete(telegramAccount).where(eq(telegramAccount.userId, userId));
	log.info('telegram', 'Cuenta desconectada', { userId });
}

export async function setTelegramOptions(
	userId: string,
	options: { groups: boolean; markRead: boolean; learnChats: { id: string; name: string }[] }
) {
	await db.update(telegramAccount).set(options).where(eq(telegramAccount.userId, userId));
	learning.set(userId, new Map(options.learnChats.map((c) => [c.id, c.name])));
}

/** For Ajustes: their latest chats (people and groups, not channels), to learn from. */
export async function recentChats(userId: string) {
	const c = clients.get(userId);
	if (!c) return [];
	const dialogs = await c.getDialogs({ limit: RECENT_CHATS });
	return dialogs
		.filter((d) => d.isUser || d.isGroup)
		.filter((d) => !(d.entity instanceof Api.User && d.entity.bot))
		.map((d) => ({ id: d.id!.toString(), name: d.title || d.name || 'Sin nombre' }));
}

async function stop(userId: string) {
	const c = clients.get(userId);
	clients.delete(userId);
	await c?.disconnect().catch(() => {});
}

/** At startup: every connected account listened to again. */
export async function startTelegram() {
	const rows = await db.select().from(telegramAccount);
	for (const row of rows) {
		const apiHash = decrypt(row.apiHash);
		const session = decrypt(row.session);
		if (!apiHash || !session) {
			log.warn('telegram', 'No se puede leer la sesión guardada (¿cambió BETTER_AUTH_SECRET?)', {
				userId: row.userId
			});
			continue;
		}
		const c = client(row.apiId, apiHash, session);
		c.connect()
			.then(() => listen(row.userId, c))
			.catch((error) =>
				log.error('telegram', 'No se pudo conectar', { userId: row.userId, error })
			);
	}
}

function listen(userId: string, c: TelegramClient) {
	clients.set(userId, c);
	c.addEventHandler(
		(event: NewMessageEvent) =>
			void received(userId, event).catch((error) =>
				log.warn('telegram', 'Mensaje no leído', { error })
			),
		new NewMessage({ incoming: true })
	);
	// Both ways, for what Seilide learns (#331).
	c.addEventHandler(
		(event: NewMessageEvent) =>
			void learnFrom(userId, event).catch((error) =>
				log.warn('telegram', 'No se pudo pasar a Seilide', { error: String(error) })
			),
		new NewMessage({})
	);
	void db
		.select({ learnChats: telegramAccount.learnChats })
		.from(telegramAccount)
		.where(eq(telegramAccount.userId, userId))
		.then(([row]) =>
			learning.set(userId, new Map((row?.learnChats ?? []).map((c) => [c.id, c.name])))
		);
}

/**
 * A message in one of the chats they chose (Ajustes), sent or received, with words enough: passed to
 * Seilide in their name, which offers in their «Buzón» what is worth remembering (#331, phase 5).
 * Without Seilide connected, nothing.
 */
async function learnFrom(userId: string, event: NewMessageEvent) {
	const m = event.message;
	const chat = learning.get(userId)?.get(m.chatId?.toString() ?? '');
	const text = m.text?.trim() ?? '';
	if (!chat || text.length < LEARN_MIN_CHARS) return;
	const link = await cloudLink();
	if (!link) return;
	const sender = m.out ? null : await m.getSender();
	if (sender instanceof Api.User && sender.bot) return;
	const from = m.out
		? null
		: sender instanceof Api.User
			? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || 'alguien'
			: 'alguien';
	await askCloud(link, '/telegram/aprender', {
		userId,
		body: { chat, from, text: text.slice(0, 2000), at: Date.now() }
	});
}

const kindOf = (m: Api.Message): TelegramKind =>
	m.voice
		? 'nota de voz'
		: m.audio
			? 'audio'
			: m.video || m.videoNote
				? 'vídeo'
				: m.sticker
					? 'pegatina'
					: m.photo
						? 'foto'
						: m.geo
							? 'ubicación'
							: m.document
								? 'archivo'
								: m.media
									? 'otro'
									: 'texto';

async function received(userId: string, event: NewMessageEvent) {
	const m = event.message;
	// For «contesta a Ana»: the last one each chat sent.
	lastIn.set(`${userId}:${m.chatId?.toString()}`, { id: m.id, at: Date.now() });
	const people = listeners.get(userId);
	// Nobody driving: nothing to say.
	if (!people?.size) return;
	if (event.isChannel && !event.isGroup) return;
	const [account] = await db
		.select({ groups: telegramAccount.groups })
		.from(telegramAccount)
		.where(eq(telegramAccount.userId, userId));
	if (event.isGroup && !account?.groups) return;
	const sender = await m.getSender();
	if (sender instanceof Api.User && sender.bot) return;
	const from =
		sender instanceof Api.User
			? [sender.firstName, sender.lastName].filter(Boolean).join(' ') || 'alguien'
			: 'alguien';
	const chat = event.isGroup
		? (((await m.getChat()) as Api.Chat | Api.Channel | undefined)?.title ?? 'un grupo')
		: null;
	const key = `${m.chatId?.toString()}:${m.id}`;
	const message: TelegramMessage = {
		key,
		from,
		chat,
		text: m.text?.trim() || null,
		kind: kindOf(m),
		at: Date.now()
	};
	const inputChat = await m.getInputChat();
	if (inputChat) sent.set(key, { userId, chat: inputChat, id: m.id });
	for (const old of [...sent.keys()].slice(0, -KEEP_FOR_READ)) sent.delete(old);
	for (const listener of people) listener(message);
}

/** Said aloud: marked read in Telegram, if the person asked for it (Ajustes). */
export async function markSaid(userId: string, key: string) {
	const message = sent.get(key);
	const c = clients.get(userId);
	if (!message || message.userId !== userId || !c) return;
	const [account] = await db
		.select({ markRead: telegramAccount.markRead })
		.from(telegramAccount)
		.where(eq(telegramAccount.userId, userId));
	if (account?.markRead) await c.markAsRead(message.chat, message.id).catch(() => {});
}

// ——— Sent by voice (#243): with the person's own account, only after their «sí» ———

/** The last message each chat sent, by `userId:chatId`: a reply to it, if recent. */
const lastIn = new Map<string, { id: number; at: number }>();
/** A reply to their last one, only this soon after it came. */
const REPLY_MS = 30 * 60_000;
/** Their chats, looked at again after this long. */
const CHATS_MS = 5 * 60_000;
/** Waiting for the «sí» this long, at most. */
const CONFIRM_MS = 3 * 60_000;
/** As alike as a name must sound (music-search.ts, `likeness`). */
const NAME_ALIKE = 0.75;

interface TelegramChat {
	id: string;
	title: string;
	group: boolean;
	entity: Api.TypeInputPeer;
}

const chatsCache = new Map<string, { at: number; chats: TelegramChat[] }>();

/** Their recent chats: people and groups, by the name they have in the account. */
async function chatsOf(userId: string, c: TelegramClient) {
	const cached = chatsCache.get(userId);
	if (cached && Date.now() - cached.at < CHATS_MS) return cached.chats;
	const dialogs = await c.getDialogs({ limit: 150 });
	const chats = dialogs.flatMap((d): TelegramChat[] => {
		const user = d.entity instanceof Api.User ? d.entity : null;
		if ((user && (user.bot || user.self)) || (d.isChannel && !d.isGroup) || !d.inputEntity)
			return [];
		return [
			{
				id: d.id?.toString() ?? '',
				title: d.title ?? d.name ?? '',
				group: d.isGroup,
				entity: d.inputEntity
			}
		];
	});
	chatsCache.set(userId, { at: Date.now(), chats });
	return chats;
}

/** What waits for the «sí», by person: and the order it was asked in, not to be confirmed in it. */
const pendingSend = new Map<
	string,
	{ chat: TelegramChat; text: string; order: string; at: number }
>();

export type PreparedSend =
	| { status: 'ready'; to: string; group: boolean; reply: boolean }
	| { status: 'choose'; options: string[] }
	| { status: 'none' }
	| { status: 'off' };

/**
 * «Dile a Ana que llego en diez minutos»: the chat found by how it sounds, and the message kept,
 * waiting for the person's «sí» (`confirmSend`), in a later order than `order`.
 */
export async function prepareSend(
	userId: string,
	to: string,
	text: string,
	order: string
): Promise<PreparedSend> {
	const c = clients.get(userId);
	if (!c) return { status: 'off' };
	const asked = words(to).filter(
		(w) => !['el', 'la', 'los', 'las', 'grupo', 'de', 'a'].includes(w)
	);
	const ranked = (await chatsOf(userId, c))
		.map((chat) => ({ chat, score: likeness(asked, chat.title) }))
		.filter((r) => r.score >= NAME_ALIKE)
		.sort((a, b) => b.score - a.score);
	if (!ranked.length) return { status: 'none' };
	const best = ranked.filter((r) => r.score >= ranked[0]!.score - 0.05);
	if (best.length > 1)
		return { status: 'choose', options: best.slice(0, 4).map((r) => r.chat.title) };
	const chat = ranked[0]!.chat;
	pendingSend.set(userId, { chat, text, order, at: Date.now() });
	const last = lastIn.get(`${userId}:${chat.id}`);
	return {
		status: 'ready',
		to: chat.title,
		group: chat.group,
		reply: Boolean(last && Date.now() - last.at < REPLY_MS)
	};
}

/** Its «sí»: what was prepared, sent; never in the same order it was asked in. Throws, said. */
export async function confirmSend(userId: string, order: string) {
	const pending = pendingSend.get(userId);
	const c = clients.get(userId);
	if (!pending || !c || Date.now() - pending.at > CONFIRM_MS)
		throw new Error('No hay ningún mensaje esperando: que diga otra vez qué mandar y a quién.');
	if (pending.order === order)
		throw new Error('Antes de mandarlo, pregúntale si lo envía y espera a que diga que sí.');
	pendingSend.delete(userId);
	const last = lastIn.get(`${userId}:${pending.chat.id}`);
	await c.sendMessage(pending.chat.entity, {
		message: pending.text,
		...(last && Date.now() - last.at < REPLY_MS ? { replyTo: last.id } : {})
	});
	log.info('telegram', `Mensaje enviado por voz a «${pending.chat.title}»`, { userId });
	return pending.chat.title;
}

/** «No»: forgotten. */
export function cancelSend(userId: string) {
	pendingSend.delete(userId);
}
