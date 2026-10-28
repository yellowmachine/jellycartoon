import { Bot, GrammyError } from 'grammy';
import { eq } from 'drizzle-orm';
import { telegramBot } from '#lib/server/db/schema.ts';
import { asFamily } from '#lib/server/family.ts';
import { decrypt, encrypt } from '#lib/server/secret-box.ts';
import { parseBotEvents, type BotEvent, type BotEvents } from '#lib/telegram-bot.ts';

/**
 * The family's Telegram bot (#253; jellycartoon's #243), with grammY (https://grammy.dev): made by
 * its administrator with @BotFather, its token in Ajustes (encrypted), and added to the family's
 * group. It tells the group what happens: the agenda, the alarms, and the house's timers (told by
 * the house, /api/casa/telegram); as the bot, saying who did what. It asks Telegram for what is new
 * itself (long polling): nothing to open to the outside. One bot per family, all in this server.
 */

/** As kept: the token, the group it tells, the groups it has seen, and what it tells. */
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

/** Each family's, running. */
const bots = new Map<string, Bot>();

async function load(familyId: string): Promise<Saved | null> {
	const [row] = await asFamily(familyId, (tx) => tx.select().from(telegramBot));
	const token = row ? decrypt(row.token) : null;
	if (!row || !token) return null;
	return {
		token,
		username: row.username,
		chat: row.chat ?? null,
		chats: row.chats ?? [],
		events: parseBotEvents(row.events)
	};
}

async function save(familyId: string, saved: Saved | null) {
	await asFamily(familyId, async (tx) => {
		if (!saved) return void (await tx.delete(telegramBot));
		const values = { ...saved, token: encrypt(saved.token) };
		await tx
			.insert(telegramBot)
			.values({ familyId, ...values })
			.onConflictDoUpdate({ target: telegramBot.familyId, set: values });
	});
}

async function update(familyId: string, change: (saved: Saved) => void) {
	const saved = await load(familyId);
	if (!saved) return;
	change(saved);
	await save(familyId, saved);
}

/** For Ajustes: its name, the group it tells and the ones it has seen, and what it tells. */
export async function botStatus(familyId: string) {
	const saved = await load(familyId);
	return saved
		? {
				username: saved.username,
				chat: saved.chat,
				chats: saved.chats,
				events: saved.events,
				running: bots.has(familyId)
			}
		: null;
}

/** A new token: checked with Telegram, kept, and the bot started with it. Throws, said for a person. */
export async function setBotToken(familyId: string, token: string) {
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
	const before = await load(familyId);
	await save(familyId, {
		token,
		username,
		chat: null,
		chats: [],
		events: before?.events ?? parseBotEvents(null)
	});
	console.info(`[telegram] Bot conectado: @${username}`, { familyId });
	await startBot(familyId);
}

export async function forgetBot(familyId: string) {
	await stopBot(familyId);
	await save(familyId, null);
	console.info('[telegram] Bot olvidado', { familyId });
}

export async function setBotChat(familyId: string, id: number) {
	await update(familyId, (s) => {
		s.chat = s.chats.find((c) => c.id === id) ?? null;
	});
}

export async function setBotEvents(familyId: string, events: BotEvents) {
	await update(familyId, (s) => {
		s.events = events;
	});
}

async function stopBot(familyId: string) {
	const running = bots.get(familyId);
	bots.delete(familyId);
	await running?.stop().catch(() => {});
}

/** At startup (scheduler.ts), or with a new token: listening for the groups it is added to. */
export async function startBot(familyId: string) {
	await stopBot(familyId);
	const saved = await load(familyId);
	if (!saved) return;
	const b = new Bot(saved.token);
	const seen = async (chat: { id: number; type: string; title?: string }) => {
		if (chat.type !== 'group' && chat.type !== 'supergroup') return;
		await update(familyId, (s) => {
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
			await update(familyId, (s) => {
				s.chats = s.chats.filter((c) => c.id !== ctx.chat.id);
				if (s.chat?.id === ctx.chat.id) s.chat = null;
			});
	});
	// A group made a supergroup changes its id.
	b.on('message:migrate_to_chat_id', async (ctx) => {
		const to = ctx.message.migrate_to_chat_id;
		await update(familyId, (s) => {
			s.chats = s.chats.map((c) => (c.id === ctx.chat.id ? { ...c, id: to } : c));
			if (s.chat?.id === ctx.chat.id) s.chat = { ...s.chat, id: to };
		});
	});
	// «/start» in a group it was added to before it had this token: seen now.
	b.command('start', async (ctx) => {
		await seen(ctx.chat);
		await ctx.reply('Hola, soy el bot de la familia: aviso aquí de la agenda y de las alarmas.');
	});
	b.catch((err) => console.warn('[telegram] El bot falló con un mensaje', err.error));
	bots.set(familyId, b);
	void b
		.start({ drop_pending_updates: true, allowed_updates: ['message', 'my_chat_member'] })
		.catch((error) => {
			console.error('[telegram] El bot se ha parado', { familyId, error: String(error) });
			if (bots.get(familyId) === b) bots.delete(familyId);
		});
}

/** To the family's group, if it tells that; never failing what happened. */
export async function tellGroup(familyId: string, event: BotEvent, text: string) {
	try {
		const bot = bots.get(familyId);
		const saved = bot ? await load(familyId) : null;
		if (!bot || !saved?.chat || !saved.events[event]) return;
		await bot.api.sendMessage(saved.chat.id, text);
	} catch (error) {
		console.warn('[telegram] No se pudo avisar al grupo', {
			familyId,
			event,
			error: String(error)
		});
	}
}

/** «Enviar una prueba», from Ajustes. Throws, said for a person. */
export async function testBot(familyId: string) {
	const bot = bots.get(familyId);
	const saved = await load(familyId);
	if (!bot || !saved) throw new Error('El bot no está conectado');
	if (!saved.chat) throw new Error('Añade el bot al grupo, o escribe /start en el grupo');
	await bot.api.sendMessage(saved.chat.id, '👋 Prueba: desde aquí avisaré de lo de la familia.');
}

/**
 * «Di en el grupo que ya está la comida», by the house's voice (#243): said by the bot, whatever it
 * tells, with who or where it comes from («📣 Desde el salón: …»). The group's name; throws, said
 * for a person.
 */
export async function sayInGroup(familyId: string, from: string, text: string) {
	const bot = bots.get(familyId);
	const saved = bot ? await load(familyId) : null;
	if (!bot || !saved?.chat) throw new Error('El bot de la familia no está en ningún grupo');
	await bot.api.sendMessage(saved.chat.id, `📣 ${from}: ${text}`);
	console.info(`[telegram] Dicho en el grupo «${saved.chat.title}» por voz`, { familyId });
	return saved.chat.title;
}

/** Whether there is a group to say things in. */
export async function botHasGroup(familyId: string) {
	return Boolean(bots.has(familyId) && (await load(familyId))?.chat);
}

/** Whether this family has a bot at all (scheduler.ts, at startup). */
export async function hasBot(familyId: string) {
	const [row] = await asFamily(familyId, (tx) =>
		tx
			.select({ id: telegramBot.familyId })
			.from(telegramBot)
			.where(eq(telegramBot.familyId, familyId))
	);
	return Boolean(row);
}
