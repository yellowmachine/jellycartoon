import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { isTheme } from 'comun/themes.ts';
import { familyMember } from '#lib/server/db/schema.ts';
import { APIError } from 'better-auth/api';
import QRCode from 'qrcode';
import type { Actions, PageServerLoad } from './$types';
import { addPerson, deletePerson, familyPeople, updatePerson } from '#lib/server/agenda/agenda.ts';
import { auth } from '#lib/server/auth.ts';
import {
	botStatus,
	forgetBot,
	setBotChat,
	setBotEvents,
	setBotToken,
	testBot
} from '#lib/server/telegram/bot.ts';
import { BOT_EVENTS, parseBotEvents } from '#lib/telegram-bot.ts';
import { withFamily } from '#lib/server/family.ts';
import {
	openRouterKeyStart,
	orsKeyStart,
	setOpenRouterKey,
	setOrsKey
} from '#lib/server/family-settings.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import {
	DEFAULT_VOICE_MODEL,
	personVoiceStyle,
	setPersonVoiceStyle,
	setQuietHours,
	setVoiceModel,
	setVoiceStyle,
	setWebSearch,
	voiceSettings
} from '#lib/server/voice/settings.ts';
import { createHouseKey, deleteHouseKey, listHouseKeys } from '#lib/server/house-keys.ts';
import {
	askHouse,
	forgetHouse,
	houseLink,
	HouseProblem,
	houseUrl,
	saveHouse
} from '#lib/server/house.ts';

export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const membership = await withFamily(locals.user!.id, async (_, m) => m);
	const admin = membership.role === 'admin';
	const voice = await voiceSettings(k);
	return {
		house: await houseLink(locals.user!.id),
		openRouter: await openRouterKeyStart(k),
		ors: await orsKeyStart(k),
		houseKeys: await listHouseKeys(locals.user!.id),
		twoFactor: Boolean(locals.user!.twoFactorEnabled),
		people: await familyPeople(k),
		telegramBot: admin ? { bot: await botStatus(membership.familyId) } : null,
		/** The family's voice (#253): its model, its character, the web, the «horas de silencio». */
		voiceModel: admin ? { model: voice.savedModel ?? '', fallback: DEFAULT_VOICE_MODEL } : null,
		houseStyle: admin ? { text: voice.style ?? '' } : null,
		voiceWeb: admin ? voice.web : null,
		voiceQuiet: admin ? { hours: voice.quiet } : null,
		/** And how it talks to each one. */
		myStyle: { text: (await personVoiceStyle(k, locals.user!.id)) ?? '' }
	};
};

/** A person's name, as written: none, not one. */
const personName = (form: FormData) =>
	String(form.get('name') ?? '')
		.trim()
		.slice(0, 40);
const drawing = (form: FormData) => (form.get('avatar') as string | null) || null;

/** Only the family's administrator connects its house. */
async function requireAdmin(userId: string, problem = 'houseProblem') {
	const admin = await withFamily(userId, async (_, m) => m.role === 'admin');
	if (!admin) return fail(403, { [problem]: 'Solo quien administra la familia' });
	return null;
}

/** The family's, if its administrator asks; a 403 otherwise. */
async function adminFamily(userId: string) {
	return withFamily(userId, async (_, m) => (m.role === 'admin' ? m.familyId : null));
}

const notAdmin = () => fail(403, { botProblem: 'Solo quien administra la familia' });

export const actions: Actions = {
	/** Their colours, in all their screens (comun/themes.ts). */
	theme: async ({ request, locals }) => {
		const theme = (await request.formData()).get('theme');
		if (!isTheme(theme)) return fail(400, { themeProblem: 'Tema no válido' });
		await withFamily(locals.user!.id, (tx) =>
			tx.update(familyMember).set({ theme }).where(eq(familyMember.userId, locals.user!.id))
		);
		return { saved: 'theme' };
	},
	/** The voice's model: «proveedor/modelo»; empty, the default. */
	saveVoiceModel: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'voiceProblem');
		if (denied) return denied;
		const model = String((await request.formData()).get('model') ?? '').trim();
		if (model && !/^[\w.~-]+\/[\w.:~-]+$/.test(model))
			return fail(400, { voiceProblem: 'El modelo es como «proveedor/modelo»' });
		await setVoiceModel(await kitchenOf(locals.user!.id), model || null);
		return { saved: 'voiceModel' };
	},
	/** «Buscar en internet desde la voz»: on or off, and where. */
	saveVoiceWeb: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'voiceProblem');
		if (denied) return denied;
		const form = await request.formData();
		await setWebSearch(await kitchenOf(locals.user!.id), {
			on: form.get('on') === 'on',
			hints: String(form.get('hints') ?? '')
		});
		return { saved: 'voiceWeb' };
	},
	/** «Horas de silencio»: both times, or none (`off`). */
	saveVoiceQuiet: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'voiceProblem');
		if (denied) return denied;
		const form = await request.formData();
		const from = String(form.get('from') ?? '');
		const to = String(form.get('to') ?? '');
		await setQuietHours(
			await kitchenOf(locals.user!.id),
			form.get('off') || !from || !to ? null : { from, to }
		);
		return { saved: 'voiceQuiet' };
	},
	/** «Cómo es la voz de la casa»: free text in the voice's instructions; empty, none. */
	saveHouseStyle: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'voiceProblem');
		if (denied) return denied;
		const text = String((await request.formData()).get('style') ?? '');
		await setVoiceStyle(await kitchenOf(locals.user!.id), text);
		return { saved: 'houseStyle' };
	},
	/** «Cómo quieres que te hable»: theirs, with each order of theirs. */
	saveMyStyle: async ({ request, locals }) => {
		const text = String((await request.formData()).get('style') ?? '');
		await setPersonVoiceStyle(await kitchenOf(locals.user!.id), locals.user!.id, text);
		return { saved: 'myStyle' };
	},
	/** The family's bot (#243): its token from @BotFather, checked with Telegram. */
	botToken: async ({ request, locals }) => {
		const familyId = await adminFamily(locals.user!.id);
		if (!familyId) return notAdmin();
		const token = String((await request.formData()).get('token') ?? '').trim();
		if (!/^\d+:[\w-]{30,}$/.test(token))
			return fail(400, { botProblem: 'El token es como 123456789:ABC…, el que da @BotFather' });
		try {
			await setBotToken(familyId, token);
		} catch (err) {
			return fail(400, { botProblem: err instanceof Error ? err.message : String(err) });
		}
		return { saved: 'bot' };
	},
	botForget: async ({ locals }) => {
		const familyId = await adminFamily(locals.user!.id);
		if (!familyId) return notAdmin();
		await forgetBot(familyId);
		return { saved: 'bot-out' };
	},
	/** The group it tells, among those it has been added to; and what it tells. */
	botOptions: async ({ request, locals }) => {
		const familyId = await adminFamily(locals.user!.id);
		if (!familyId) return notAdmin();
		const form = await request.formData();
		const chat = Number(form.get('chat'));
		if (chat) await setBotChat(familyId, chat);
		await setBotEvents(
			familyId,
			parseBotEvents(
				Object.fromEntries(Object.keys(BOT_EVENTS).map((k) => [k, form.get(k) === 'on']))
			)
		);
		return { saved: 'bot-options' };
	},
	botTest: async ({ locals }) => {
		const familyId = await adminFamily(locals.user!.id);
		if (!familyId) return notAdmin();
		try {
			await testBot(familyId);
		} catch (err) {
			return fail(400, { botProblem: err instanceof Error ? err.message : String(err) });
		}
		return { saved: 'bot-test' };
	},
	/** One of the family without an account (a child), for the agenda and the alarms. */
	addPerson: async ({ request, locals }) => {
		const form = await request.formData();
		const name = personName(form);
		if (!name) return fail(400, { personProblem: 'Falta el nombre' });
		await addPerson(await kitchenOf(locals.user!.id), name, drawing(form));
	},
	updatePerson: async ({ request, locals }) => {
		const form = await request.formData();
		const name = personName(form);
		if (!name) return fail(400, { personProblem: 'Falta el nombre' });
		await updatePerson(
			await kitchenOf(locals.user!.id),
			Number(form.get('id')),
			name,
			drawing(form)
		);
	},
	deletePerson: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		await deletePerson(await kitchenOf(locals.user!.id), id);
	},
	/** Its address (jellycartoon's MEDIA_HOST) and the key made in its Ajustes → Casa → «La nube». */
	saveHouse: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id);
		if (denied) return denied;
		const form = await request.formData();
		const url = houseUrl(String(form.get('url') ?? ''));
		if (!url) return fail(400, { houseProblem: 'La dirección, con https://, sin nada detrás' });
		const key = String(form.get('key') ?? '').trim() || null;
		// jellycartoon's keys: not something else (a password the browser filled in by itself).
		if (key && !/^casita_\w{20,}$/.test(key))
			return fail(400, {
				houseProblem:
					'Esa no es una clave de jellycartoon: empiezan por casita_ (Ajustes → Casa → «La nube»)'
			});
		const webValue = String(form.get('webUrl') ?? '').trim();
		const webUrl = webValue ? houseUrl(webValue) : null;
		if (webValue && !webUrl)
			return fail(400, {
				houseProblem: 'La dirección de jellycartoon, con https://, sin nada detrás'
			});
		if (!key && !(await houseLink(locals.user!.id)))
			return fail(400, { houseProblem: 'Falta la clave' });
		await saveHouse(locals.user!.id, url, key, webUrl);
		return { saved: 'house' };
	},
	forgetHouse: async ({ locals }) => {
		const denied = await requireAdmin(locals.user!.id);
		if (denied) return denied;
		await forgetHouse(locals.user!.id);
		return { saved: 'house' };
	},
	/** The house asked in this person's name: its series, as the road mode will. */
	testHouse: async ({ locals }) => {
		try {
			const { series } = await askHouse<{ series: unknown[] }>(
				locals.user!.id,
				locals.user!.email,
				'/series'
			);
			return { houseOk: `La casa contesta: ${series.length} series para ti` };
		} catch (error) {
			if (error instanceof HouseProblem) return fail(502, { houseProblem: error.message });
			throw error;
		}
	},
	/** A key for the house (jellycartoon) to use the family's fridge and recipes: shown once. */
	createHouseKey: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'houseKeyProblem');
		if (denied) return denied;
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name || name.length > 32)
			return fail(400, { houseKeyProblem: 'Ponle un nombre de hasta 32 letras' });
		return { houseKey: await createHouseKey(locals.user!.id, name), houseKeyName: name };
	},
	deleteHouseKey: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'houseKeyProblem');
		if (denied) return denied;
		await deleteHouseKey(locals.user!.id, String((await request.formData()).get('id') ?? ''));
		return { saved: 'houseKeys' };
	},
	/** The family's OpenRouter key (https://openrouter.ai/keys), for the AI; empty, none. */
	saveOpenRouter: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'openRouterProblem');
		if (denied) return denied;
		const key = String((await request.formData()).get('key') ?? '').trim();
		if (key && !key.startsWith('sk-or-'))
			return fail(400, { openRouterProblem: 'Las claves de OpenRouter empiezan por sk-or-' });
		await setOpenRouterKey(await kitchenOf(locals.user!.id), key || null);
		return { saved: 'openRouter' };
	},
	/** openrouteservice's key (#78), for the road mode's routes: the family's administrator. */
	saveOrs: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'orsProblem');
		if (denied) return denied;
		const key = String((await request.formData()).get('key') ?? '').trim();
		// Not a password the browser filled in by itself: openrouteservice's are long, without spaces.
		if (key && !/^[\w=+/-]{30,}$/.test(key))
			return fail(400, { orsProblem: 'Esa no parece una clave de openrouteservice' });
		await setOrsKey(await kitchenOf(locals.user!.id), key || null);
		return { saved: 'ors' };
	},
	/** The second step: the password, then its QR and recovery codes, then a code to turn it on. */
	enableTwoFactor: async ({ request }) => {
		const password = String((await request.formData()).get('password') ?? '');
		try {
			const result = await auth.api.enableTwoFactor({
				body: { password },
				headers: request.headers
			});
			// Codes by an app (TOTP): the plugin's default, as configured in auth.ts.
			if (result.method !== 'totp') throw new Error('Se esperaba TOTP');
			const { totpURI, backupCodes } = result;
			return { totpQr: await QRCode.toDataURL(totpURI), totpURI, backupCodes };
		} catch (error) {
			if (error instanceof APIError)
				return fail(400, { twoFactorProblem: 'Contraseña incorrecta' });
			throw error;
		}
	},
	confirmTwoFactor: async ({ request }) => {
		const code = String((await request.formData()).get('code') ?? '').replace(/\s+/g, '');
		try {
			await auth.api.verifyTOTP({ body: { code }, headers: request.headers });
		} catch (error) {
			if (error instanceof APIError)
				return fail(400, { twoFactorProblem: 'Ese código no vale: mira el de ahora en tu app' });
			throw error;
		}
		return { saved: 'twoFactor' };
	},
	disableTwoFactor: async ({ request }) => {
		const password = String((await request.formData()).get('password') ?? '');
		try {
			await auth.api.disableTwoFactor({ body: { password }, headers: request.headers });
		} catch (error) {
			if (error instanceof APIError)
				return fail(400, { twoFactorProblem: 'Contraseña incorrecta' });
			throw error;
		}
		return { saved: 'twoFactor' };
	}
};
