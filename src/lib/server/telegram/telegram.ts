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
import type { TelegramKind, TelegramMessage } from '#lib/telegram.ts';

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
			markRead: telegramAccount.markRead
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
		throw new Error(said(err));
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
		throw new Error(said(err));
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
		throw new Error(said(err));
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
	options: { groups: boolean; markRead: boolean }
) {
	await db.update(telegramAccount).set(options).where(eq(telegramAccount.userId, userId));
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
	const people = listeners.get(userId);
	// Nobody driving: nothing to say.
	if (!people?.size) return;
	const m = event.message;
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
