import { error, fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { eq } from 'drizzle-orm';
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
	DEFAULT_HOMEWORK_MODEL,
	homeworkModel,
	isAdmin,
	DEFAULT_ORS_URL,
	getAppSetting,
	openRouterConfig,
	openRouterManagementKey,
	orsConfig,
	relayConfig,
	setAppSetting,
	setOpenRouterManagementKey,
	visionModel,
	voiceModel
} from '#lib/server/app-settings.ts';
import { voiceEnabled } from '#lib/server/voice/whisper.ts';
import {
	createSatellite,
	deleteSatellite,
	listSatellites,
	setSatelliteSpeakers
} from '#lib/server/satellites.ts';
import { listSpeakers, snapcastVoiceReady } from '#lib/server/music/snapcast.ts';
import {
	findPlaces,
	housePlace,
	placeName,
	setHousePlace,
	type Place
} from '#lib/server/weather.ts';
import {
	houseVoice,
	isPiperVoice,
	piperEnabled,
	setHouseVoice,
	spanishVoices,
	type VoiceOption
} from '#lib/server/piper.ts';
import {
	forgetFiller,
	getFillers,
	getRecordings,
	recordFiller,
	setFillers,
	warmFillers
} from '#lib/server/voice-fillers.ts';
import { DEFAULT_TONE, MAX_TONE_CHARS } from '#lib/voice-fillers.ts';
import { getVoiceLevels, setVoiceLevels } from '#lib/server/voice/levels.ts';
import { parseVoiceLevels } from '#lib/voice-levels.ts';
import {
	accountCredits,
	completeJson,
	creditRecharged,
	keyBalance,
	OAUTH_COOKIE,
	openRouterAuth
} from '#lib/server/openrouter.ts';
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
import { startUpdateOnce, versionInfo } from '#lib/server/updates.ts';
import {
	appPasswordCreated,
	generateAppPassword,
	revokeAppPassword
} from '#lib/server/subsonic/auth.ts';
import { musicRoot } from '#lib/server/library/paths.ts';
import { LABEL_MODEL, ORIGIN } from '$app/env/private';
import {
	deleteLabelSet,
	labelSets,
	labellingEnabled,
	saveLabelSet
} from '#lib/server/episode-labels.ts';
import { recordsTrips, setRecordTrips } from '#lib/server/trips.ts';
import { canUseTwoFactor } from '#lib/server/two-factor.ts';
import { randomBytes } from 'node:crypto';
import {
	adults,
	deviceOf,
	forgetDevice,
	kidProfiles,
	saveKid as saveKidProfile,
	trustDevice,
	trustedDevices
} from '#lib/server/kid-login.ts';
import { isAvatar } from '#lib/avatars.ts';
import { avatarOf, createAdult, houseAdults, invite, setAvatar } from '#lib/server/people.ts';
import { askEvery } from '#lib/server/still-there.ts';
import { ASK_EVERY_OPTIONS } from '#lib/still-there.ts';
import {
	checkCode,
	checkPassword,
	disconnect as disconnectTelegram,
	sendCode,
	setTelegramOptions,
	telegramOf
} from '#lib/server/telegram/telegram.ts';
import {
	botStatus,
	forgetBot,
	setBotChat,
	setBotEvents,
	setBotToken,
	testBot
} from '#lib/server/telegram/bot.ts';
import { BOT_EVENTS, parseBotEvents } from '#lib/telegram-bot.ts';
import { MAX_VOICE_STYLE } from '#lib/voice.ts';

export const load: PageServerLoad = async ({ locals, cookies, url, request }) => {
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
	let people = null;
	let routes = null;
	let relay = null;
	let labels = null;
	let satellites = null;
	let satelliteSpeakers = null;
	let satelliteAnswers = false;
	let home = null;
	let houseVoiceChoice = null;
	if (admin) {
		/** The voice the satellites answer with (#223): among Piper's installed ones. */
		if (piperEnabled) {
			let options: VoiceOption[] = [];
			let problem: string | null = null;
			try {
				options = await spanishVoices();
			} catch (err) {
				problem = err instanceof Error ? err.message : String(err);
			}
			houseVoiceChoice = {
				options,
				problem,
				chosen: await houseVoice(),
				fillers: (await getFillers()).join('\n'),
				recordings: await getRecordings(),
				levels: await getVoiceLevels(),
				/** «Música mientras habla» only matters if they answer through Snapcast. */
				snapcast: snapcastVoiceReady()
			};
		}
		/** Where the house is, for the voice's weather (#223). */
		const place = await housePlace();
		home = { place, name: place ? placeName(place) : null };
		/** Voice satellites (#223): only where there is voice (WHISPER_URL). */
		if (voiceEnabled) {
			satellites = await listSatellites(request.headers);
			/** Each one's room speaker, lowered while it listens: the Snapcast ones. */
			satelliteSpeakers = await listSpeakers();
			/** And answering through them: with snapserver's `Voz` source. */
			satelliteAnswers = snapcastVoiceReady();
		}
		/** What the vision model looks for in episodes: only with Ollama (OLLAMA_URL). */
		if (labellingEnabled) labels = { sets: await labelSets(), model: LABEL_MODEL };
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
		const [config, chat, vision, voice, homework, kidAccounts, grownUps, devices, here, house] =
			await Promise.all([
				openRouterConfig(),
				chatConfig(),
				visionModel(),
				voiceModel(),
				homeworkModel(),
				kidProfiles(),
				adults(),
				trustedDevices(),
				deviceOf(cookies),
				houseAdults()
			]);
		/** The adults of the house (#157): the administrator adds them, and gives them their link. */
		people = { adults: house };
		/**
		 * Children's accounts (#17), and how they enter (#141): with a password, or choosing their
		 * avatar on a device of the house while one of their parents or guardians lets them in.
		 */
		kids = { accounts: kidAccounts, adults: grownUps, devices, here: here?.id ?? null };
		ai = {
			chatModel: chat.model,
			defaultChatModel: DEFAULT_CHAT_MODEL,
			chatWeb: chat.web,
			keySource: config.keySource,
			// Never the key itself: only enough to recognise it.
			keyHint: config.apiKey ? `…${config.apiKey.slice(-4)}` : null,
			/** Only whether there is one: it never leaves the server. */
			hasManagementKey: Boolean(await openRouterManagementKey()),
			/** Back from «Conectar con OpenRouter»: `ok`, or what went wrong. */
			connected: url.searchParams.get('openrouter'),
			model: config.model,
			defaultModel: DEFAULT_MODEL,
			visionModel: vision,
			defaultVisionModel: DEFAULT_VISION_MODEL,
			/** Only where there is voice (WHISPER_URL). */
			voice: voiceEnabled,
			voiceModel: voice,
			defaultVoiceModel: DEFAULT_VOICE_MODEL,
			homeworkModel: homework,
			defaultHomeworkModel: DEFAULT_HOMEWORK_MODEL,
			/** Streamed: OpenRouter answering slowly does not hold up the page. */
			balance: keyBalance()
		};
	}

	const twoFactorOn = Boolean(locals.user!.twoFactorEnabled);
	return {
		account: {
			name: locals.user!.name,
			email: locals.user!.email,
			/** An adult chooses their own drawing (#157); a child's, the administrator. */
			avatar: isKid(locals.user) ? undefined : ((await avatarOf(locals.user!))?.id ?? null)
		},
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
		/** The title card when the app opens, as Frasier's. */
		openingQuoteOn: settings.openingQuote,
		djMix: settings.djMix,
		/** The month's AI spending under the header (#193): an adult's, with a key to ask; null, not shown. */
		spendLine: !isKid(locals.user) && (await openRouterConfig()).apiKey ? settings.spendLine : null,
		/** «¿Sigues ahí?» (#77): adults only; a child's is chosen in /infantil. */
		stillThere: isKid(locals.user) ? null : { every: await askEvery(userId) },
		/** «Guardar lo que veo»: adults only, a child's is always kept for the adults (#17). */
		keepHistory: isKid(locals.user) ? null : settings.keepHistory,
		/** The road mode's trips kept (#81); adults only. */
		recordTrips: isKid(locals.user) ? null : await recordsTrips(userId),
		/** How the voice is (free text in its instructions): the house's, for who manages the app. */
		houseStyle: admin && voiceEnabled ? { text: (await getAppSetting('voice_style')) ?? '' } : null,
		/** And how it talks to them: an adult's. */
		myStyle: !isKid(locals.user) && voiceEnabled ? { text: settings.voiceStyle ?? '' } : null,
		/** The house's Telegram bot (#243), telling the family's group: who manages the app. */
		telegramBot: admin ? { bot: await botStatus() } : null,
		/** Their own Telegram (#243), read aloud in the road mode: adults only. Never its session. */
		telegram: isKid(locals.user) ? null : { account: await telegramOf(userId) },
		/** Langua, the language app: adults only. Never the token itself, only its end. */
		langua: isKid(locals.user)
			? null
			: langua
				? { url: langua.url, tokenHint: `…${langua.token.slice(-4)}` }
				: { url: null, tokenHint: null },
		ai,
		routes,
		relay,
		labels,
		satellites,
		satelliteSpeakers,
		satelliteAnswers,
		home,
		houseVoice: houseVoiceChoice,
		/** Children's accounts (#17): only who manages the app creates them. */
		kids,
		people,
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
	/** The satellites' voice (#223). */
	saveHouseVoice: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const voice = { voice: form.get('voice'), speaker: form.get('speaker') || null };
		if (!isPiperVoice(voice)) return fail(400, { voiceProblem: 'Voz no válida' });
		await setHouseVoice(voice);
		void warmFillers();
		log.info(
			'ajustes',
			`Voz de la casa: ${voice.voice}${voice.speaker ? ` ${voice.speaker}` : ''}`
		);
		return { saved: 'houseVoice' };
	},
	/** The satellites' voice louder, and the music lower under it (#223). */
	saveVoiceLevels: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const levels = parseVoiceLevels(Object.fromEntries(form));
		await setVoiceLevels(levels);
		// Read again in its new way, to sound at once.
		void warmFillers();
		log.info('ajustes', 'Volumen de la voz de los satélites', { ...levels });
		return { saved: 'voiceLevels' };
	},
	/** One of the phrases said while the AI thinks, recorded by the AI voice (#223). */
	recordFiller: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const text = String(form.get('text') ?? '');
		if (!(await getFillers()).includes(text))
			return fail(400, { fillerProblem: 'Guarda la frase antes de grabarla' });
		const tone =
			String(form.get('tone') ?? '')
				.trim()
				.slice(0, MAX_TONE_CHARS) || DEFAULT_TONE;
		try {
			await recordFiller(text, tone);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log.warn('ajustes', 'No se pudo grabar la frase de espera', { text, error: err });
			return fail(502, { fillerProblem: `No se pudo grabar: ${message}` });
		}
		log.info('ajustes', 'Frase de espera grabada con voz IA', { text, tone });
		return { saved: 'fillerRecorded' };
	},
	/** That phrase back to Piper's voice. */
	forgetFiller: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const text = String((await request.formData()).get('text') ?? '');
		await forgetFiller(text);
		log.info('ajustes', 'Frase de espera de vuelta a Piper', { text });
		return { saved: 'fillerForgotten' };
	},
	/** What the satellites say while the AI thinks (#223), one a line; empty, the default ones. */
	saveFillers: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const text = form.get('reset') ? null : String(form.get('fillers') ?? '');
		await setFillers(text);
		log.info('ajustes', 'Frases de espera de los satélites', { fillers: await getFillers() });
		return { saved: 'fillers' };
	},
	/** Where the house is (#223): what Open-Meteo finds by that name, to choose one. */
	findHousePlace: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { placeProblem: 'Escribe el pueblo o la ciudad' });
		try {
			return { placeOptions: await findPlaces(name) };
		} catch (err) {
			return fail(503, { placeProblem: err instanceof Error ? err.message : String(err) });
		}
	},
	saveHousePlace: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		let place: Place;
		try {
			const p = JSON.parse(String((await request.formData()).get('place') ?? ''));
			if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || typeof p.name !== 'string')
				throw new Error();
			place = {
				name: p.name.slice(0, 100),
				region: typeof p.region === 'string' ? p.region.slice(0, 100) : null,
				country: typeof p.country === 'string' ? p.country.slice(0, 100) : null,
				lat: p.lat,
				lon: p.lon
			};
		} catch {
			return fail(400, { placeProblem: 'Sitio no válido' });
		}
		await setHousePlace(place);
		log.info('ajustes', `La casa está en ${placeName(place)}`);
		return { saved: 'house' };
	},
	clearHousePlace: async ({ locals }) => {
		await requireAdmin(locals.user!.id);
		await setHousePlace(null);
		return { saved: 'house' };
	},
	/** A voice satellite (#223): its key, shown once. */
	createSatellite: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name || name.length > 32)
			return fail(400, { satelliteProblem: 'Ponle un nombre de hasta 32 letras' });
		const key = await createSatellite(name, request.headers);
		log.info('ajustes', `Satélite de voz nuevo: «${name}»`);
		return { satelliteKey: key, satelliteName: name };
	},
	/** Its room's speaker (#223), lowered while it listens, and where it answers; empty, none. */
	saveSatelliteSpeakers: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const speaker = String(form.get('speaker') ?? '') || null;
		const answer = String(form.get('answer') ?? '') || null;
		await setSatelliteSpeakers(id, { speaker, answer }, request.headers);
		log.info('ajustes', 'Altavoces del satélite de voz', { id, speaker, answer });
		return { saved: 'satellites' };
	},
	deleteSatellite: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const id = String((await request.formData()).get('id') ?? '');
		await deleteSatellite(id, request.headers);
		log.info('ajustes', 'Satélite de voz quitado', { id });
		return { saved: 'satellites' };
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
			if ((await startUpdateOnce()) === 'not-ready')
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
	 * An adult of the house (#157), without a password: the page shows the link and QR with which
	 * they choose it.
	 */
	createAdult: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const email = String(form.get('email') ?? '').trim();
		const avatar = String(form.get('avatar') ?? '');
		if (!name || !email) return fail(400, { section: 'people', message: 'Escribe nombre y email' });
		if (!isAvatar(avatar)) return fail(400, { section: 'people', message: 'Elige un dibujo' });
		let userId;
		try {
			userId = await createAdult({ name, email, avatar });
		} catch (err) {
			if (err instanceof APIError) return fail(400, { section: 'people', message: err.message });
			throw err;
		}
		log.info('ajustes', `Persona añadida: ${name}`);
		return { invited: { ...(await invite(userId)), name } };
	},
	/** Another link for an adult: theirs expired or got lost, or they forgot their password. */
	newLink: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const userId = String((await request.formData()).get('userId') ?? '');
		const [person] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId));
		if (!person) return fail(400, { section: 'people', message: 'No está en la casa' });
		try {
			const link = await invite(userId);
			log.info('ajustes', `Enlace nuevo para entrar: ${person.name}`);
			return { invited: { ...link, name: person.name } };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return fail(400, { section: 'people', message });
		}
	},
	/** An adult's drawing, from «Personas de la casa». */
	saveAdult: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const avatar = String(form.get('avatar') ?? '');
		const [person] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId));
		if (!person || isKid(person))
			return fail(400, { section: 'people', message: 'No es un adulto de la casa' });
		if (!isAvatar(avatar)) return fail(400, { section: 'people', message: 'Elige un dibujo' });
		await setAvatar(userId, avatar);
		return { saved: 'adult' };
	},
	/** One's own drawing, in Cuenta: adults only. */
	myAvatar: async ({ request, locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		const avatar = String((await request.formData()).get('avatar') ?? '');
		if (!isAvatar(avatar)) return fail(400, { section: 'avatar', message: 'Elige un dibujo' });
		await setAvatar(locals.user!.id, avatar);
		return { saved: 'avatar' };
	},
	/**
	 * A child's account, «infantil» from the start: with the admin plugin, from the server, so its
	 * role is not something the account can change.
	 */
	createKid: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const byApproval = form.get('byApproval') === 'on';
		const avatar = String(form.get('avatar') ?? '');
		// Without a password it only enters by permission: an email nobody types, as Better Auth asks.
		const email =
			String(form.get('email') ?? '').trim() ||
			(byApproval ? `peque-${randomBytes(6).toString('hex')}@jellycartoon.invalid` : '');
		const password = byApproval
			? randomBytes(32).toString('base64url')
			: String(form.get('password') ?? '');
		if (!name || !email) return fail(400, { section: 'kids', message: 'Escribe nombre y email' });
		if (!isAvatar(avatar)) return fail(400, { section: 'kids', message: 'Elige un dibujo' });
		// Better Auth's own minimum, which creating it from the server does not check.
		if (password.length < 8)
			return fail(400, { section: 'kids', message: 'La contraseña, de 8 caracteres o más' });
		try {
			const { user: kid } = await auth.api.createUser({
				body: { name, email, password, role: KIDS_ROLE, data: { emailVerified: true } }
			});
			await saveKidProfile(
				kid.id,
				{ avatar, byApproval, guardians: form.getAll('guardian').map(String) },
				request.headers
			);
		} catch (err) {
			if (err instanceof APIError) return fail(400, { section: 'kids', message: err.message });
			throw err;
		}
		log.info('ajustes', `Cuenta infantil creada: ${name}`, { byApproval });
		return { saved: 'kids' };
	},
	/** A child's avatar, how it enters, and who lets it in (#141). */
	saveKid: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const kidId = String(form.get('kidId') ?? '');
		const avatar = String(form.get('avatar') ?? '');
		const byApproval = form.get('byApproval') === 'on';
		const password = String(form.get('password') ?? '');
		if (!isAvatar(avatar)) return fail(400, { section: 'kids', message: 'Elige un dibujo' });
		if (password && password.length < 8)
			return fail(400, { section: 'kids', message: 'La contraseña, de 8 caracteres o más' });
		const [kid] = await db
			.select({ name: user.name, role: user.role })
			.from(user)
			.where(eq(user.id, kidId));
		if (kid?.role !== KIDS_ROLE) return fail(400, { section: 'kids', message: 'No es un peque' });
		try {
			await saveKidProfile(
				kidId,
				{
					avatar,
					byApproval,
					guardians: form.getAll('guardian').map(String),
					password: password || undefined
				},
				request.headers
			);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return fail(400, { section: 'kids', message });
		}
		log.info('ajustes', `Peque guardado: ${kid.name}`, { byApproval });
		return { saved: 'kid' };
	},
	/** This device, as the house's: it shows «¿Quién eres?» when nobody has entered (#141). */
	trustDevice: async ({ request, locals, cookies }) => {
		await requireAdmin(locals.user!.id);
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { section: 'kids', message: 'Ponle un nombre: «la TV del salón»' });
		await trustDevice(cookies, name.slice(0, 60), locals.user!.id);
		return { saved: 'device' };
	},
	forgetDevice: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { section: 'kids', message: 'No válido' });
		await forgetDevice(id);
		return { saved: 'device' };
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
	/** «¿Sigues ahí?» (#77) for an adult: never, or after this many episodes in a row. */
	askEvery: async ({ request, locals }) => {
		if (isKid(locals.user)) error(403, 'Solo adultos');
		const value = String((await request.formData()).get('askEvery') ?? '');
		const every = value === '' ? null : Number(value);
		if (every !== null && !(ASK_EVERY_OPTIONS as readonly number[]).includes(every))
			return fail(400, { section: 'askEvery', message: 'Valor no válido' });
		await db
			.insert(userSettings)
			.values({ userId: locals.user!.id, askEvery: every })
			.onConflictDoUpdate({ target: userSettings.userId, set: { askEvery: every } });
		return { saved: 'askEvery' };
	},
	openingQuote: async ({ request, locals }) => {
		const values = { openingQuote: (await request.formData()).get('openingQuote') === 'on' };
		await db
			.insert(userSettings)
			.values({ userId: locals.user!.id, ...values })
			.onConflictDoUpdate({ target: userSettings.userId, set: values });
		return { saved: 'openingQuote' };
	},
	/** Modo DJ: the DJ's words between the songs, or over them (in the browser). */
	djMix: async ({ request, locals }) => {
		const values = { djMix: (await request.formData()).get('djMix') === 'mix' };
		await db
			.insert(userSettings)
			.values({ userId: locals.user!.id, ...values })
			.onConflictDoUpdate({ target: userSettings.userId, set: values });
		return { saved: 'djMix' };
	},
	/** The month's AI spending under the header (#193): an adult's choice. */
	spendLine: async ({ request, locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		const values = { spendLine: (await request.formData()).get('spendLine') === 'on' };
		await db
			.insert(userSettings)
			.values({ userId: locals.user!.id, ...values })
			.onConflictDoUpdate({ target: userSettings.userId, set: values });
		return { saved: 'spendLine' };
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
	/** «Cómo es la voz de la casa»: free text in the voice's instructions; empty, none. */
	saveHouseStyle: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const text = String((await request.formData()).get('style') ?? '')
			.trim()
			.slice(0, MAX_VOICE_STYLE);
		await setAppSetting('voice_style', text || null);
		log.info('ajustes', 'Carácter de la voz de la casa', { style: text });
		return { saved: 'houseStyle' };
	},
	/** «Cómo quieres que te hable»: theirs, with each order of theirs. */
	saveMyStyle: async ({ request, locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		const text = String((await request.formData()).get('style') ?? '')
			.trim()
			.slice(0, MAX_VOICE_STYLE);
		const values = { voiceStyle: text || null };
		await db
			.insert(userSettings)
			.values({ userId: locals.user!.id, ...values })
			.onConflictDoUpdate({ target: userSettings.userId, set: values });
		return { saved: 'myStyle' };
	},
	/** The house's bot (#243): its token from @BotFather, checked with Telegram. */
	botToken: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const token = String((await request.formData()).get('token') ?? '').trim();
		if (!/^\d+:[\w-]{30,}$/.test(token))
			return fail(400, { botProblem: 'El token es como 123456789:ABC…, el que da @BotFather' });
		try {
			await setBotToken(token);
		} catch (err) {
			return fail(400, { botProblem: err instanceof Error ? err.message : String(err) });
		}
		return { saved: 'bot' };
	},
	botForget: async ({ locals }) => {
		await requireAdmin(locals.user!.id);
		await forgetBot();
		return { saved: 'bot-out' };
	},
	/** The group it tells, among those it has been added to; and what it tells. */
	botOptions: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const chat = Number(form.get('chat'));
		if (chat) await setBotChat(chat);
		await setBotEvents(
			parseBotEvents(
				Object.fromEntries(Object.keys(BOT_EVENTS).map((k) => [k, form.get(k) === 'on']))
			)
		);
		return { saved: 'bot-options' };
	},
	botTest: async ({ locals }) => {
		await requireAdmin(locals.user!.id);
		try {
			await testBot();
		} catch (err) {
			return fail(400, { botProblem: err instanceof Error ? err.message : String(err) });
		}
		return { saved: 'bot-test' };
	},
	/** Telegram (#243), first step: its app's data and the number; Telegram sends a code. */
	telegramCode: async ({ request, locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		const form = await request.formData();
		const apiId = Number(form.get('apiId'));
		const apiHash = String(form.get('apiHash') ?? '').trim();
		const phone = String(form.get('phone') ?? '').replace(/[\s-]/g, '');
		if (!Number.isInteger(apiId) || apiId <= 0 || !/^[0-9a-f]{32}$/i.test(apiHash))
			return fail(400, {
				telegramProblem: 'El api_id es un número y el api_hash, 32 letras y números'
			});
		if (!/^\+\d{8,15}$/.test(phone))
			return fail(400, { telegramProblem: 'El número, con su prefijo: +34…' });
		try {
			await sendCode(locals.user!.id, apiId, apiHash, phone);
		} catch (err) {
			return fail(400, { telegramProblem: err instanceof Error ? err.message : String(err) });
		}
		return { telegramStep: 'code' as const };
	},
	/** The code Telegram sent; maybe its two-step password after. */
	telegramSignIn: async ({ request, locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		const code = String((await request.formData()).get('code') ?? '').replace(/\D/g, '');
		try {
			const step = await checkCode(locals.user!.id, code);
			return { telegramStep: step === 'ok' ? ('done' as const) : ('password' as const) };
		} catch (err) {
			return fail(400, {
				telegramProblem: err instanceof Error ? err.message : String(err),
				telegramStep: 'code' as const
			});
		}
	},
	telegramPassword: async ({ request, locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		const password = String((await request.formData()).get('password') ?? '');
		try {
			await checkPassword(locals.user!.id, password);
			return { telegramStep: 'done' as const };
		} catch (err) {
			return fail(400, {
				telegramProblem: err instanceof Error ? err.message : String(err),
				telegramStep: 'password' as const
			});
		}
	},
	telegramOptions: async ({ request, locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		const form = await request.formData();
		await setTelegramOptions(locals.user!.id, {
			groups: form.get('groups') === 'on',
			markRead: form.get('markRead') === 'on'
		});
		return { saved: 'telegram' };
	},
	telegramDisconnect: async ({ locals }) => {
		if (isKid(locals.user)) error(404, 'No encontrado');
		await disconnectTelegram(locals.user!.id);
		return { saved: 'telegram-out' };
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
		// Another key may have credit: tried again.
		creditRecharged();
		log.info('ajustes', 'Clave de OpenRouter cambiada');
		return { saved: 'key' };
	},
	deleteKey: async ({ locals }) => {
		await requireAdmin(locals.user!.id);
		await setAppSetting('openrouter_api_key', null);
		log.info('ajustes', 'Clave de OpenRouter borrada');
		return { saved: 'key' };
	},
	/**
	 * «Conectar con OpenRouter»: off to sign in and authorise, and back to ./openrouter with the
	 * code for the key. What proves it is this browser's own request goes in a short cookie.
	 */
	connectOpenRouter: async ({ locals, cookies, url }) => {
		await requireAdmin(locals.user!.id);
		const auth = openRouterAuth(`${url.origin}/ajustes/openrouter`);
		cookies.set(OAUTH_COOKIE, JSON.stringify({ verifier: auth.verifier, state: auth.state }), {
			path: '/ajustes',
			httpOnly: true,
			// Sent when OpenRouter's page sends the browser back here.
			sameSite: 'lax',
			maxAge: 600
		});
		// Kit only goes to another site when told which one.
		redirect(303, auth.url, { external: ['https://openrouter.ai'] });
	},
	/** Only to read the account's real balance; checked with OpenRouter before keeping it. */
	saveManagementKey: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const key = String((await request.formData()).get('key') ?? '').trim();
		if (!key) return fail(400, { section: 'ai', message: 'Escribe la clave de gestión' });
		try {
			await accountCredits(key);
		} catch (err) {
			return fail(400, {
				section: 'ai',
				message: err instanceof Error ? err.message : String(err)
			});
		}
		await setOpenRouterManagementKey(key);
		log.info('ajustes', 'Clave de gestión de OpenRouter guardada');
		return { saved: 'managementKey' };
	},
	deleteManagementKey: async ({ locals }) => {
		await requireAdmin(locals.user!.id);
		await setOpenRouterManagementKey(null);
		log.info('ajustes', 'Clave de gestión de OpenRouter borrada');
		return { saved: 'managementKey' };
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
	/** The episodes' labels, separated by commas: episodes labelled again look for the new ones. */
	/** A set of labels for the episodes, new or changed: what the vision model looks for. */
	saveLabelSet: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const form = await request.formData();
		const id = Number(form.get('id')) || undefined;
		try {
			await saveLabelSet({
				id,
				name: String(form.get('name') ?? ''),
				labels: String(form.get('labels') ?? '')
			});
		} catch (err) {
			return fail(400, {
				section: 'labels',
				message: err instanceof Error ? err.message : String(err)
			});
		}
		return { saved: 'labelSet' };
	},
	/** Out, with what it saw and its requests. */
	deleteLabelSet: async ({ request, locals }) => {
		await requireAdmin(locals.user!.id);
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { section: 'labels', message: 'No válido' });
		await deleteLabelSet(id);
		return { saved: 'labelSet' };
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
						: use === 'homework'
							? (['openrouter_homework_model', 'homeworkModel'] as const)
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
