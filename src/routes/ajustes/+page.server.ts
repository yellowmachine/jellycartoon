import { error, fail } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { asc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { user, userSettings } from '#lib/server/db/schema.ts';
import { auth } from '#lib/server/auth.ts';
import { isKid, KIDS_ROLE } from '#lib/server/kids.ts';
import {
	chatConfig,
	DEFAULT_CHAT_MODEL,
	DEFAULT_MODEL,
	DEFAULT_VISION_MODEL,
	DEFAULT_VOICE_MODEL,
	isAdmin,
	DEFAULT_ORS_URL,
	openRouterConfig,
	orsConfig,
	relayConfig,
	setAppSetting,
	visionModel,
	voiceModel
} from '#lib/server/app-settings.ts';
import { voiceEnabled } from '#lib/server/voice/whisper.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { getSettings, setKeepHistory } from '#lib/server/settings.ts';
import {
	languaConfig,
	normalizeLanguaUrl,
	pingLangua,
	setLanguaConfig
} from '#lib/server/langua.ts';
import { mpvEnabled } from '#lib/server/cinema/mpv.ts';
import { hasIntro } from '#lib/server/library/paths.ts';
import { KNOWN_LANGUAGES, normalizeLang } from '#lib/languages.ts';
import { isTheme } from '#lib/themes.ts';
import { log } from '#lib/server/log.ts';
import { startUpdate, versionInfo } from '#lib/server/updates.ts';
import {
	appPasswordCreated,
	generateAppPassword,
	revokeAppPassword
} from '#lib/server/subsonic/auth.ts';
import { musicRoot } from '#lib/server/library/paths.ts';
import { ORIGIN } from '$app/env/private';
import { recordsTrips, setRecordTrips } from '#lib/server/trips.ts';
import { canUseTwoFactor } from '#lib/server/two-factor.ts';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const admin = await isAdmin(userId);
	const [settings, introFound, version, appPassword, langua] = await Promise.all([
		getSettings(userId),
		hasIntro(),
		// Only who manages the app sees the new version: for them, asked now (#20).
		versionInfo({ fresh: admin }),
		musicRoot ? appPasswordCreated(userId) : null,
		languaConfig(userId)
	]);

	let ai = null;
	let kids = null;
	let routes = null;
	let relay = null;
	if (admin) {
		const r = await relayConfig();
		/** Sharing trips (#81): the relay. Never its key: only whether there is one. */
		relay = { url: r.url ?? '', hasKey: Boolean(r.key), fromEnv: r.fromEnv };
		const ors = await orsConfig();
		/** The road mode's routes (#78): openrouteservice. Never the key: only enough to recognise it. */
		routes = {
			keySource: ors.keySource,
			keyHint: ors.apiKey ? `…${ors.apiKey.slice(-4)}` : null,
			url: ors.url === DEFAULT_ORS_URL ? '' : ors.url,
			defaultUrl: DEFAULT_ORS_URL
		};
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

	const twoFactorOn = Boolean(locals.user!.twoFactorEnabled);
	return {
		account: { name: locals.user!.name, email: locals.user!.email },
		/**
		 * The second step after the password: not for children's accounts; the administrator always
		 * has it. How many recovery codes are left, as each is used once.
		 */
		twoFactor: canUseTwoFactor(locals.user!)
			? {
					enabled: twoFactorOn,
					required: admin,
					codesLeft: twoFactorOn
						? (await auth.api.viewBackupCodes({ body: { userId } })).backupCodes.length
						: null
				}
			: null,
		playback: { audioLang: settings.audioLang, subtitleLang: settings.subtitleLang },
		/** Also for mpv in the living room, where films are watched. */
		subtitleStyle: settings.subtitleStyle,
		// Only with films in the living room and the intro in DATA_DIR.
		intro: mpvEnabled && introFound ? settings.intro : null,
		languages: KNOWN_LANGUAGES,
		/** «Guardar lo que veo»: adults only, a child's is always kept for the adults (#17). */
		keepHistory: isKid(locals.user) ? null : settings.keepHistory,
		/** The road mode's trips kept (#81); adults only. */
		recordTrips: isKid(locals.user) ? null : await recordsTrips(userId),
		/** Langua, the language app: adults only. Never the token itself, only its end. */
		langua: isKid(locals.user)
			? null
			: langua
				? { url: langua.url, tokenHint: `…${langua.token.slice(-4)}` }
				: { url: null, tokenHint: null },
		ai,
		routes,
		relay,
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
	/** Ten new recovery codes, shown once; the ones before stop working. */
	newBackupCodes: async ({ request }) => {
		const password = String((await request.formData()).get('password') ?? '');
		try {
			const { backupCodes } = await auth.api.generateBackupCodes({
				body: { password },
				headers: request.headers
			});
			return { backupCodes };
		} catch (err) {
			if (err instanceof APIError) return fail(400, { twoFactorProblem: 'Contraseña incorrecta' });
			throw err;
		}
	},
	/** Without the second step again; not for the administrator, who always has it. */
	disableTwoFactor: async ({ request, locals }) => {
		if (await isAdmin(locals.user!.id))
			return fail(403, { twoFactorProblem: 'El administrador siempre la lleva' });
		const password = String((await request.formData()).get('password') ?? '');
		try {
			await auth.api.disableTwoFactor({ body: { password }, headers: request.headers });
		} catch (err) {
			if (err instanceof APIError) return fail(400, { twoFactorProblem: 'Contraseña incorrecta' });
			throw err;
		}
		return { twoFactorOff: true };
	},
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
	/** The whole app changes at once: the layout reloads with it. */
	theme: async ({ request, locals }) => {
		const theme = (await request.formData()).get('theme');
		if (!isTheme(theme)) return fail(400, { section: 'theme', message: 'Tema no válido' });
		await db
			.insert(userSettings)
			.values({ userId: locals.user!.id, theme })
			.onConflictDoUpdate({ target: userSettings.userId, set: { theme } });
		return { saved: 'theme' };
	},
	intro: async ({ request, locals }) => {
		const values = { intro: (await request.formData()).get('intro') === 'on' };
		await db
			.insert(userSettings)
			.values({ userId: locals.user!.id, ...values })
			.onConflictDoUpdate({ target: userSettings.userId, set: values });
		return { saved: 'intro' };
	},
	recordTrips: async ({ request, locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		await setRecordTrips(locals.user!.id, (await request.formData()).get('recordTrips') === 'on');
		return { saved: 'recordTrips' };
	},
	history: async ({ request, locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		await setKeepHistory(locals.user!.id, (await request.formData()).get('keepHistory') === 'on');
		return { saved: 'history' };
	},
	saveLangua: async ({ request, locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		const form = await request.formData();
		const url = normalizeLanguaUrl(String(form.get('url') ?? ''));
		if (!url) return fail(400, { section: 'langua', message: 'La dirección, como https://…' });
		const token = String(form.get('token') ?? '').trim();
		const hadToken = Boolean(await languaConfig(locals.user!.id));
		if (!token && !hadToken) return fail(400, { section: 'langua', message: 'Falta el token' });
		await setLanguaConfig(locals.user!.id, { url, ...(token && { token }) });
		return { saved: 'langua' };
	},
	testLangua: async ({ locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		const config = await languaConfig(locals.user!.id);
		if (!config)
			return fail(400, { section: 'langua', message: 'Primero la dirección y el token' });
		const problem = await pingLangua(config);
		return problem ? fail(502, { section: 'langua', message: problem }) : { languaOk: true };
	},
	forgetLangua: async ({ locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		await setLanguaConfig(locals.user!.id, { url: null, token: null });
		return { saved: 'langua-forgotten' };
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
	/** The trips relay (#81): its address, and its key if one is written (empty keeps it). */
	saveRelay: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const url = String(form.get('url') ?? '')
			.trim()
			.replace(/\/+$/, '');
		const key = String(form.get('key') ?? '').trim();
		if (url && !/^https:\/\/\S+$/.test(url))
			return fail(400, {
				section: 'relay',
				message: 'La dirección tiene que empezar por https://'
			});
		await setAppSetting('relay_url', url || null);
		if (key) await setAppSetting('relay_key', key);
		log.info('ajustes', 'Repetidor de viajes cambiado', { url: url || null, key: Boolean(key) });
		return { saved: 'relay' };
	},
	saveOrsKey: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const key = String((await request.formData()).get('key') ?? '').trim();
		if (!key) return fail(400, { section: 'routes', message: 'Escribe la clave' });
		await setAppSetting('ors_api_key', key);
		log.info('ajustes', 'Clave de openrouteservice cambiada');
		return { saved: 'orsKey' };
	},
	deleteOrsKey: async ({ locals }) => {
		await requireAdmin(locals.user!.id);
		await setAppSetting('ors_api_key', null);
		log.info('ajustes', 'Clave de openrouteservice borrada');
		return { saved: 'orsKey' };
	},
	/** Empty: openrouteservice's own. Another: one's own, self-hosted (Docker). */
	saveOrsUrl: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const url = String((await request.formData()).get('url') ?? '')
			.trim()
			.replace(/\/+$/, '');
		if (url && !/^https?:\/\/\S+$/.test(url))
			return fail(400, {
				section: 'routes',
				message: 'La dirección tiene que empezar por http:// o https://'
			});
		await setAppSetting('ors_url', url || null);
		log.info('ajustes', 'Dirección de openrouteservice cambiada', { url: url || null });
		return { saved: 'orsUrl' };
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
