import { error, fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { asc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { user, userSettings } from '#lib/server/db/schema.ts';
import { auth } from '#lib/server/auth.ts';
import { KIDS_ROLE } from '#lib/server/kids.ts';
import {
	chatConfig,
	DEFAULT_CHAT_MODEL,
	DEFAULT_MODEL,
	DEFAULT_VISION_MODEL,
	DEFAULT_VOICE_MODEL,
	isAdmin,
	openRouterConfig,
	setAppSetting,
	visionModel,
	voiceModel
} from '#lib/server/app-settings.ts';
import { voiceEnabled } from '#lib/server/voice/whisper.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { getSettings } from '#lib/server/settings.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { hasIntro } from '#lib/server/library/paths.ts';
import { KNOWN_LANGUAGES, normalizeLang } from '#lib/languages.ts';
import { log } from '#lib/server/log.ts';
import { startUpdate, versionInfo } from '#lib/server/updates.ts';
import {
	appPasswordCreated,
	generateAppPassword,
	revokeAppPassword
} from '#lib/server/subsonic/auth.ts';
import { musicRoot } from '#lib/server/library/paths.ts';
import { ORIGIN } from '$app/env/private';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const admin = await isAdmin(userId);
	const [settings, introFound, version, appPassword] = await Promise.all([
		getSettings(userId),
		hasIntro(),
		// Only who manages the app sees the new version: for them, asked now (#20).
		versionInfo({ fresh: admin }),
		musicRoot ? appPasswordCreated(userId) : null
	]);

	let ai = null;
	let kids = null;
	if (admin) {
		const [config, chat, vision, voice, kidAccounts] = await Promise.all([
			openRouterConfig(),
			chatConfig(),
			visionModel(),
			voiceModel(),
			db
				.select({ id: user.id, name: user.name, email: user.email })
				.from(user)
				.where(eq(user.role, KIDS_ROLE))
				.orderBy(asc(user.name))
		]);
		kids = kidAccounts;
		ai = {
			chatModel: chat.model,
			defaultChatModel: DEFAULT_CHAT_MODEL,
			chatWeb: chat.web,
			keySource: config.keySource,
			// Never the key itself: only enough to recognise it.
			keyHint: config.apiKey ? `…${config.apiKey.slice(-4)}` : null,
			model: config.model,
			defaultModel: DEFAULT_MODEL,
			visionModel: vision,
			defaultVisionModel: DEFAULT_VISION_MODEL,
			/** Only where there is voice (WHISPER_URL). */
			voice: voiceEnabled,
			voiceModel: voice,
			defaultVoiceModel: DEFAULT_VOICE_MODEL
		};
	}

	return {
		account: { name: locals.user!.name, email: locals.user!.email },
		playback: { audioLang: settings.audioLang, subtitleLang: settings.subtitleLang },
		// Only with films in the living room and the intro in DATA_DIR.
		intro: mpvEnabled && introFound ? settings.intro : null,
		languages: KNOWN_LANGUAGES,
		ai,
		/** Children's accounts (#17): only who manages the app creates them. */
		kids,
		/** Music in apps such as Tempus (#27): with the account's email and a password of their own. */
		musicApps: musicRoot
			? { server: ORIGIN, username: locals.user!.email, since: appPassword }
			: null,
		/** The new version and its button, only for who manages the app (#20). */
		version: admin ? version : { ...version, update: null, canUpdate: false }
	};
};

async function requireAdmin(userId: string) {
	if (!(await isAdmin(userId))) error(403, 'Solo quien creó la primera cuenta puede cambiar esto');
}

/** `''` is "by default" (audio) or "none" (subtitles), as in the player. */
const lang = (value: FormDataEntryValue | null) =>
	typeof value === 'string' && value ? normalizeLang(value) : null;

export const actions: Actions = {
	/** A new password for music apps: shown once, and the one before stops working. */
	appPassword: async ({ locals }) => {
		const password = await generateAppPassword(locals.user!.id);
		log.info('ajustes', 'Contraseña para apps de música nueva');
		return { appPassword: password };
	},
	revokeAppPassword: async ({ locals }) => {
		await revokeAppPassword(locals.user!.id);
		log.info('ajustes', 'Contraseña para apps de música quitada');
		return { saved: 'musicApps' };
	},
	/** Now, instead of at night: WUD replaces the container, and the page reloads on its own. */
	update: async ({ locals }) => {
		await requireAdmin(locals.user!.id);
		try {
			if ((await startUpdate()) === 'not-ready')
				return fail(409, {
					section: 'version',
					message:
						'La imagen de la versión nueva todavía no está lista: se publica unos minutos después. Prueba un poco más tarde.'
				});
		} catch (err) {
			log.error('versiones', 'No se pudo pedir la actualización a WUD', { error: err });
			return fail(502, {
				section: 'version',
				message: err instanceof Error ? err.message : String(err)
			});
		}
		return { updating: true };
	},
	/**
	 * A child's account, «infantil» from the start: with the admin plugin, from the server, so its
	 * role is not something the account can change.
	 */
	createKid: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		if (!name || !email) return fail(400, { section: 'kids', message: 'Escribe nombre y email' });
		// Better Auth's own minimum, which creating it from the server does not check.
		if (password.length < 8)
			return fail(400, { section: 'kids', message: 'La contraseña, de 8 caracteres o más' });
		try {
			await auth.api.createUser({ body: { name, email, password, role: KIDS_ROLE } });
		} catch (err) {
			if (err instanceof APIError) return fail(400, { section: 'kids', message: err.message });
			throw err;
		}
		log.info('ajustes', `Cuenta infantil creada: ${name}`);
		return { saved: 'kids' };
	},
	playback: async ({ request, locals }) => {
		const form = await request.formData();
		const values = {
			audioLang: lang(form.get('audioLang')),
			subtitleLang: lang(form.get('subtitleLang'))
		};
		await db
			.insert(userSettings)
			.values({ userId: locals.user!.id, ...values })
			.onConflictDoUpdate({ target: userSettings.userId, set: values });
		return { saved: 'playback' };
	},
	intro: async ({ request, locals }) => {
		const values = { intro: (await request.formData()).get('intro') === 'on' };
		await db
			.insert(userSettings)
			.values({ userId: locals.user!.id, ...values })
			.onConflictDoUpdate({ target: userSettings.userId, set: values });
		return { saved: 'intro' };
	},
	saveKey: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const key = String((await request.formData()).get('key') ?? '').trim();
		if (!key) return fail(400, { section: 'ai', message: 'Escribe la clave' });
		await setAppSetting('openrouter_api_key', key);
		log.info('ajustes', 'Clave de OpenRouter cambiada');
		return { saved: 'key' };
	},
	deleteKey: async ({ locals }) => {
		await requireAdmin(locals.user!.id);
		await setAppSetting('openrouter_api_key', null);
		log.info('ajustes', 'Clave de OpenRouter borrada');
		return { saved: 'key' };
	},
	/** An empty model goes back to the default one. */
	saveModel: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const model = String(form.get('model') ?? '').trim();
		if (model && !/^[\w.~-]+\/[\w.:~-]+$/.test(model))
			return fail(400, { section: 'ai', message: 'El modelo es como «proveedor/modelo»' });
		const use = form.get('use');
		const [key, saved] =
			use === 'chat'
				? (['openrouter_chat_model', 'chatModel'] as const)
				: use === 'vision'
					? (['openrouter_vision_model', 'visionModel'] as const)
					: use === 'voice'
						? (['openrouter_voice_model', 'voiceModel'] as const)
						: (['openrouter_model', 'model'] as const);
		await setAppSetting(key, model || null);
		return { saved };
	},
	saveChatWeb: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const web = (await request.formData()).get('web') === 'on';
		await setAppSetting('openrouter_chat_web', web ? 'true' : null);
		return { saved: 'chatWeb' };
	},
	/** A tiny request with the current key and model, to know they work before relying on them. */
	testAi: async ({ locals }) => {
		await requireAdmin(locals.user!.id);
		try {
			const answer = await completeJson<{ ok: boolean }>({
				system: 'Responde solo con el JSON pedido.',
				prompt: 'Devuelve ok a true.',
				name: 'check',
				label: 'Prueba de la clave',
				schema: {
					type: 'object',
					properties: { ok: { type: 'boolean' } },
					required: ['ok'],
					additionalProperties: false
				}
			});
			return { tested: answer.ok === true };
		} catch (err) {
			log.warn('ajustes', 'Prueba de OpenRouter fallida', { error: err });
			return fail(502, {
				section: 'ai',
				message: err instanceof Error ? err.message : String(err)
			});
		}
	}
};
