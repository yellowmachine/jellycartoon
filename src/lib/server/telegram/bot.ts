import { Bot, GrammyError } from 'grammy';
import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import { log } from '#lib/server/log.ts';
import { decrypt, encrypt } from '#lib/server/secret-box.ts';
import { listSaid, parseBotEvents, type BotEvent, type BotEvents } from '#lib/telegram-bot.ts';

/**
 * The house's Telegram bot (#243), with grammY (https://grammy.dev): made by whoever manages the app
 * with @BotFather, its token in Ajustes → Casa (encrypted), and added to the family's group. It tells
 * the group what happens at home: the shopping list, the fridge's post-its, the Agenda, the house's
 * alarms; as the bot, saying who did what («🛒 María ha añadido a la lista: leche»). It asks Telegram
 * for what is new itself (long polling): nothing to open to the outside.
 */

/** As kept: the token encrypted, the group it tells, the groups it has seen, and what it tells. */
interface Saved {
	token: string;
	username: string | null;
	chat: Chat | null;
	chats: Chat[];
	events: BotEvents;
}

interface Chat {
	id: number;
	title: string;
}

/** Things added (or bought) together, told in one message after this long. */
const LIST_AFTER_MS = 60_000;

let bot: Bot | null = null;

async function load(): Promise<Saved | null> {
	try {
		const saved = JSON.parse((await getAppSetting('telegram_bot')) ?? 'null');
		if (!saved?.token) return null;
		const token = decrypt(saved.token);
		if (!token) return null;
		return {
			token,
			username: saved.username ?? null,
			chat: saved.chat ?? null,
			chats: Array.isArray(saved.chats) ? saved.chats : [],
			events: parseBotEvents(saved.events)
		};
	} catch {
		return null;
	}
}

async function save(saved: Saved | null) {
	await setAppSetting(
		'telegram_bot',
		saved ? JSON.stringify({ ...saved, token: encrypt(saved.token) }) : null
	);
}

async function update(change: (saved: Saved) => void) {
	const saved = await load();
	if (!saved) return;
	change(saved);
	await save(saved);
}

/** For Ajustes: its name, the group it tells and the ones it has seen, and what it tells. */
export async function botStatus() {
	const saved = await load();
	return saved
		? {
				username: saved.username,
				chat: saved.chat,
				chats: saved.chats,
				events: saved.events,
				running: bot !== null
			}
		: null;
}

/** A new token: checked with Telegram, kept, and the bot started with it. Throws, said for a person. */
export async function setBotToken(token: string) {
	const probe = new Bot(token);
	let username: string;
	try {
		username = (await probe.api.getMe()).username;
	} catch (err) {
		throw new Error(
			err instanceof GrammyError && err.error_code === 401
				? 'Telegram no reconoce ese token: cópialo otra vez de @BotFather'
				: `Telegram: ${err instanceof Error ? err.message : String(err)}`
		);
	}
	const before = await load();
	await save({
		token,
		username,
		chat: null,
		chats: [],
		events: before?.events ?? parseBotEvents(null)
	});
	log.info('telegram', `Bot conectado: @${username}`);
	await startBot();
}

export async function forgetBot() {
	await stopBot();
	await save(null);
	log.info('telegram', 'Bot olvidado');
}

export async function setBotChat(id: number) {
	await update((s) => {
		s.chat = s.chats.find((c) => c.id === id) ?? null;
	});
}

export async function setBotEvents(events: BotEvents) {
	await update((s) => {
		s.events = events;
	});
}

async function stopBot() {
	const running = bot;
	bot = null;
	await running?.stop().catch(() => {});
}

/** At startup, or with a new token: listening for the groups it is added to. */
export async function startBot() {
	await stopBot();
	const saved = await load();
	if (!saved) return;
	const b = new Bot(saved.token);
	const seen = async (chat: { id: number; type: string; title?: string }) => {
		if (chat.type !== 'group' && chat.type !== 'supergroup') return;
		await update((s) => {
			const title = chat.title ?? 'Un grupo';
			s.chats = [...s.chats.filter((c) => c.id !== chat.id), { id: chat.id, title }];
			// The only one: chosen already.
			if (!s.chat && s.chats.length === 1) s.chat = s.chats[0]!;
		});
	};
	// Added to a group (or taken out of one).
	b.on('my_chat_member', async (ctx) => {
		const status = ctx.myChatMember.new_chat_member.status;
		if (status === 'member' || status === 'administrator') await seen(ctx.chat);
		else
			await update((s) => {
				s.chats = s.chats.filter((c) => c.id !== ctx.chat.id);
				if (s.chat?.id === ctx.chat.id) s.chat = null;
			});
	});
	// A group made a supergroup changes its id.
	b.on('message:migrate_to_chat_id', async (ctx) => {
		const to = ctx.message.migrate_to_chat_id;
		await update((s) => {
			s.chats = s.chats.map((c) => (c.id === ctx.chat.id ? { ...c, id: to } : c));
			if (s.chat?.id === ctx.chat.id) s.chat = { ...s.chat, id: to };
		});
	});
	// «/start» in a group it was added to before it had this token: seen now.
	b.command('start', async (ctx) => {
		await seen(ctx.chat);
		await ctx.reply(
			'Hola, soy el bot de JellyCartoon: aviso aquí de la lista de la compra, la nevera, la agenda y las alarmas de casa.'
		);
	});
	b.catch((err) => log.warn('telegram', 'El bot falló con un mensaje', { error: err.error }));
	bot = b;
	void b
		.start({ drop_pending_updates: true, allowed_updates: ['message', 'my_chat_member'] })
		.catch((error) => {
			log.error('telegram', 'El bot se ha parado', { error });
			if (bot === b) bot = null;
		});
}

/** To the group, if it tells that; never failing what happened at home. */
export async function tellGroup(event: BotEvent, text: string) {
	try {
		const saved = await load();
		if (!bot || !saved?.chat || !saved.events[event]) return;
		await bot.api.sendMessage(saved.chat.id, text);
	} catch (error) {
		log.warn('telegram', 'No se pudo avisar al grupo', { event, error });
	}
}

/** «Enviar una prueba», from Ajustes. Throws, said for a person. */
export async function testBot() {
	const saved = await load();
	if (!bot || !saved) throw new Error('El bot no está conectado');
	if (!saved.chat) throw new Error('Añade el bot al grupo, o escribe /start en el grupo');
	await bot.api.sendMessage(
		saved.chat.id,
		'👋 Prueba de JellyCartoon: desde aquí avisaré de lo de casa.'
	);
}

/** Waiting to be told together: who and what, by what was done. */
const pendingList = new Map<
	string,
	{
		who: string | null;
		verb: 'añadido' | 'comprado';
		items: string[];
		timer: ReturnType<typeof setTimeout>;
	}
>();

/** The shopping list: what is added (or bought) in a minute, in one message per person. */
export function tellList(who: string | null, verb: 'añadido' | 'comprado', items: string[]) {
	if (!items.length || !bot) return;
	const key = `${verb}|${who ?? ''}`;
	const pending = pendingList.get(key);
	if (pending) {
		pending.items.push(...items.filter((i) => !pending.items.includes(i)));
		return;
	}
	pendingList.set(key, {
		who,
		verb,
		items: [...items],
		timer: setTimeout(() => {
			const told = pendingList.get(key);
			pendingList.delete(key);
			if (told) void tellGroup('lista', listSaid(told.who, told.verb, told.items));
		}, LIST_AFTER_MS)
	});
}

/**
 * «Di en el grupo que ya está la comida», by voice (#243): said by the bot, whatever it tells, with
 * who or where it comes from («📣 Desde el salón: …»). The group's name; throws, said for a person.
 */
export async function sayInGroup(from: string, text: string) {
	const saved = await load();
	if (!bot || !saved?.chat) throw new Error('El bot de la casa no está en ningún grupo');
	await bot.api.sendMessage(saved.chat.id, `📣 ${from}: ${text}`);
	log.info('telegram', `Dicho en el grupo «${saved.chat.title}» por voz`, { from });
	return saved.chat.title;
}

/** Whether there is a group to say things in. */
export async function botHasGroup() {
	return Boolean(bot && (await load())?.chat);
}
