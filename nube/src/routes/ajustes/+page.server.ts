import { fail } from '@sveltejs/kit';
import { keyLimit } from '#lib/server/ai-spend.ts';
import { eq } from 'drizzle-orm';
import { isTheme } from 'comun/themes.ts';
import { family, familyMember } from '#lib/server/db/schema.ts';
import { EMAIL } from '#lib/invitation.ts';
import { APIError } from 'better-auth/api';
import QRCode from 'qrcode';
import type { Actions, PageServerLoad } from './$types';
import { addPerson, deletePerson, familyPeople, updatePerson } from '#lib/server/agenda/agenda.ts';
import {
	familyAdults,
	familyKids,
	giveKidAccount,
	setGuardians,
	takeKidAccount
} from '#lib/server/kids.ts';
import {
	deviceOf,
	forgetDevice,
	trustDevice,
	trustedDevices,
	untrustThisDevice
} from '#lib/server/kid-login.ts';
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
	familyPlace,
	openRouterKey,
	openRouterKeyStart,
	orsKeyStart,
	setFamilyPlace,
	setOpenRouterKey,
	setOrsKey
} from '#lib/server/family-settings.ts';
import { placeName, type Place } from 'comun/weather.ts';
import { findPlacesFor } from '#lib/server/places.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import {
	DEFAULT_VOICE_MODEL,
	personVoiceStyle,
	setPersonVoiceStyle,
	setQuietHours,
	setVoiceModel,
	setVoiceStyle,
	setVoiceLearn,
	setWebSearch,
	voiceSettings
} from '#lib/server/voice/settings.ts';
import { forgetLearned, listLearned } from '#lib/server/voice/learned.ts';
import { editMemory, forget, listMemories, remember } from '#lib/server/memory.ts';
import { RULE_TEMPLATES } from '#lib/rule-templates.ts';
import {
	deleteRule,
	listRules,
	saveRule,
	setRulePaused,
	translateRule,
	tryRule
} from '#lib/server/rules.ts';
import { createHouseKey, deleteHouseKey, listHouseKeys } from '#lib/server/house-keys.ts';
import {
	createSatellite,
	deleteSatellite,
	listSatellites,
	MAX_SATELLITE_NAME,
	setSnapserver
} from '#lib/server/satellites.ts';
import { parseSnapserver } from '#lib/snapserver.ts';
import { satelliteVoiceOf, setSatelliteVoice } from '#lib/server/voice/satellite-voice.ts';
import { invitationLink, invitations, inviteAndSend } from '#lib/server/invitations.ts';
import {
	createHouseClient,
	deleteHouseClient,
	houseClients,
	refusedByProvider
} from '#lib/server/house-clients.ts';
import { ORIGIN } from '$app/env/private';
import {
	askHouse,
	forgetHouse,
	houseLink,
	HouseProblem,
	houseUrl,
	saveHouse
} from '#lib/server/house.ts';
import { recordsTrips, setRecordTrips } from '#lib/server/trips/trips.ts';
import { deleteCar, listCars, myCarId, saveCar, setMyCar } from '#lib/server/trips/cars.ts';
import { MAX_CAR_NAME } from '#lib/cars.ts';
import { fold } from 'comun/music.ts';
import { subtitleStyleOf } from '#lib/server/subtitles.ts';
import { prayerModeOn, setPrayerMode } from '#lib/server/prayers.ts';

export const load: PageServerLoad = async ({ locals, request, cookies }) => {
	const k = await kitchenOf(locals.user!.id);
	const membership = await withFamily(locals.user!.id, async (_, m) => m);
	const admin = membership.role === 'admin';
	const voice = await voiceSettings(k);
	return {
		house: await houseLink(locals.user!.id),
		openRouter: await openRouterKeyStart(k),
		/** The key's own limit, if it has one, to who runs the family: it comes after the page. */
		openRouterLimit: admin ? openRouterKey(k).then((key) => (key ? keyLimit(key) : null)) : null,
		ors: await orsKeyStart(k),
		houseKeys: await listHouseKeys(locals.user!.id),
		/** The voice satellites Seilide serves (#296): its administrator. */
		satellites: admin ? { own: await listSatellites(locals.user!.id), origin: ORIGIN } : null,
		/** How they speak (#296): Gemini's voice, its tone, what they say while the AI thinks. */
		satelliteVoice: admin ? await satelliteVoiceOf(k) : null,
		twoFactor: Boolean(locals.user!.twoFactorEnabled),
		people: await familyPeople(k),
		/** The children with an account and who lets each in (#303), and the adults who may. */
		kids: admin ? { kids: await familyKids(k), adults: await familyAdults(k) } : null,
		/** The children's devices (#303): this one, if it is, and all of them. Its administrator. */
		kidDevices: admin
			? {
					here: (await deviceOf(cookies))?.name ?? null,
					all: await trustedDevices(k)
				}
			: null,
		telegramBot: admin ? { bot: await botStatus(membership.familyId) } : null,
		/** «Entrar con la nube» (#279): its houses' clients, and the cloud's address for their .env. */
		houseClients: admin ? { clients: await houseClients(request.headers), origin: ORIGIN } : null,
		/** The family's open invitations, with their links: only its administrator. */
		invitations: admin
			? (await invitations.ofFamily(membership.familyId)).map(({ token, ...i }) => ({
					...i,
					link: invitationLink(token)
				}))
			: null,
		/** The family's voice (#253): its model, its character, the web, the «horas de silencio». */
		voiceModel: admin ? { model: voice.savedModel ?? '', fallback: DEFAULT_VOICE_MODEL } : null,
		houseStyle: admin ? { text: voice.style ?? '' } : null,
		voiceWeb: admin ? voice.web : null,
		/** «Aprender de lo que se habla» (#331): only its administrator. */
		voiceLearn: admin ? voice.learn : null,
		voiceQuiet: admin ? { hours: voice.quiet } : null,
		/** What the voice learned from its questions, by place (learned.ts). */
		voiceLearned: admin ? await listLearned(k) : null,
		/** Oración (#339) in the bar, on or off: only its administrator. */
		prayerMode: admin ? await prayerModeOn(k) : null,
		/** «Dónde vivís», if said: only its administrator. */
		place: admin ? await familyPlace(k).then((p) => ({ name: p ? placeName(p) : null })) : null,
		/** And how it talks to each one. */
		myStyle: { text: (await personVoiceStyle(k, locals.user!.id)) ?? '' },
		/** Whether the road mode keeps their trips (Viajes). */
		recordTrips: await recordsTrips(k),
		/** The family's cars (#317), and theirs. */
		cars: (await listCars(k)).map(({ id, name }) => ({ id, name })),
		myCar: await myCarId(k),
		/** The AI's spending under the header (#193); null without the family's key. */
		spendLine: (await openRouterKey(k))
			? await withFamily(locals.user!.id, async (tx) => {
					const [me] = await tx
						.select({ on: familyMember.spendLine })
						.from(familyMember)
						.where(eq(familyMember.userId, locals.user!.id));
					return me?.on ?? false;
				})
			: null,
		/** What the voice remembers: theirs (no one else sees it) and the house's. */
		memories: await listMemories(k, locals.user!.id, true),
		/** Rules ready to turn on (#331, phase 7), and whether they have each one on. */
		ruleTemplates: await listRules(k, locals.user!.id).then((rules) =>
			RULE_TEMPLATES.map((t) => ({
				id: t.id,
				title: t.title,
				does: t.does,
				on: rules.some((r) => r.userId === locals.user!.id && r.spec.template === t.id)
			}))
		),
		/** Their rules and the house's (#331): as understood, and the last time each told. */
		rules: (await listRules(k, locals.user!.id)).map((r) => ({
			id: r.id,
			mine: Boolean(r.userId),
			said: r.said,
			understood: r.understood,
			paused: r.paused,
			aloud: r.spec.say ?? !r.userId,
			lastFiredAt: r.lastFiredAt,
			lastWhy: r.lastWhy
		})),
		/** «Cómo te aviso» (#331): the messages left for them, by email too. */
		inboxByEmail: await withFamily(locals.user!.id, async (tx) => {
			const [me] = await tx
				.select({ on: familyMember.inboxByEmail })
				.from(familyMember)
				.where(eq(familyMember.userId, locals.user!.id));
			return me?.on ?? false;
		}),
		/** How their subtitles look (Canales). */
		subtitleStyle: await subtitleStyleOf(k)
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

/** A place as Open-Meteo found it, back from the page: only what a place has. */
function placeFrom(value: unknown): Place | null {
	try {
		const p = JSON.parse(String(value ?? ''));
		if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || typeof p.name !== 'string')
			return null;
		return {
			name: p.name.slice(0, 100),
			region: typeof p.region === 'string' ? p.region.slice(0, 100) : null,
			country: typeof p.country === 'string' ? p.country.slice(0, 100) : null,
			lat: p.lat,
			lon: p.lon
		};
	} catch {
		return null;
	}
}

export const actions: Actions = {
	/** «Dónde vivís»: the towns found by that name (places.ts), to choose one. */
	findPlace: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'placeProblem');
		if (denied) return denied;
		const name = String((await request.formData()).get('name') ?? '').trim();
		if (!name) return fail(400, { placeProblem: 'Escribe el pueblo o la ciudad' });
		try {
			return { familyPlaces: await findPlacesFor(await kitchenOf(locals.user!.id), name) };
		} catch (err) {
			return fail(503, { placeProblem: err instanceof Error ? err.message : String(err) });
		}
	},
	savePlace: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'placeProblem');
		if (denied) return denied;
		const place = placeFrom((await request.formData()).get('place'));
		if (!place) return fail(400, { placeProblem: 'Sitio no válido' });
		await setFamilyPlace(await kitchenOf(locals.user!.id), place);
		return { saved: 'place' };
	},
	clearPlace: async ({ locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'placeProblem');
		if (denied) return denied;
		await setFamilyPlace(await kitchenOf(locals.user!.id), null);
		return { saved: 'place' };
	},
	/** Their colours, in all their screens (comun/themes.ts). */
	theme: async ({ request, locals }) => {
		const theme = (await request.formData()).get('theme');
		if (!isTheme(theme)) return fail(400, { themeProblem: 'Tema no válido' });
		await withFamily(locals.user!.id, (tx) =>
			tx.update(familyMember).set({ theme }).where(eq(familyMember.userId, locals.user!.id))
		);
		return { saved: 'theme' };
	},
	/** «Guardar mis viajes»: off deletes nothing already kept. */
	recordTrips: async ({ request, locals }) => {
		const on = (await request.formData()).get('recordTrips') === 'on';
		await setRecordTrips(await kitchenOf(locals.user!.id), on);
		return { saved: 'recordTrips' };
	},
	/** A car (#317): a new one, or its new name; not one already there. */
	saveCar: async ({ request, locals }) => {
		const form = await request.formData();
		const k = await kitchenOf(locals.user!.id);
		const raw = form.get('id');
		const id = raw ? Number(raw) : null;
		if (id !== null && !Number.isInteger(id)) return fail(400, { carProblem: 'Coche no válido' });
		const name = String(form.get('name') ?? '')
			.trim()
			.replace(/\s+/g, ' ')
			.slice(0, MAX_CAR_NAME);
		if (!name) return fail(400, { carProblem: 'Falta el nombre del coche' });
		if ((await listCars(k)).some((c) => c.id !== id && fold(c.name) === fold(name)))
			return fail(400, { carProblem: `Ya hay uno que se llama «${name}»` });
		await saveCar(k, id, name);
	},
	deleteCar: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { carProblem: 'Coche no válido' });
		await deleteCar(await kitchenOf(locals.user!.id), id);
	},
	/** «El tuyo»: the car their trips go in, and the one on their home page. */
	myCar: async ({ request, locals }) => {
		const raw = (await request.formData()).get('car');
		const id = raw ? Number(raw) : null;
		if (id !== null && !Number.isInteger(id)) return fail(400, { carProblem: 'Coche no válido' });
		await setMyCar(await kitchenOf(locals.user!.id), id);
		return { saved: 'myCar' };
	},
	/** «Mostrar el gasto en IA bajo la cabecera». */
	/** «Cómo te aviso» (#331): the messages left for them, by email too. */
	inboxByEmail: async ({ request, locals }) => {
		const inboxByEmail = (await request.formData()).get('inboxByEmail') === 'on';
		await withFamily(locals.user!.id, (tx) =>
			tx.update(familyMember).set({ inboxByEmail }).where(eq(familyMember.userId, locals.user!.id))
		);
		return { saved: 'inboxByEmail' };
	},
	spendLine: async ({ request, locals }) => {
		const spendLine = (await request.formData()).get('spendLine') === 'on';
		await withFamily(locals.user!.id, (tx) =>
			tx.update(familyMember).set({ spendLine }).where(eq(familyMember.userId, locals.user!.id))
		);
		return { saved: 'spendLine' };
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
	/** «Aprender de lo que se habla» (#331), on or off. */
	saveVoiceLearn: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'voiceProblem');
		if (denied) return denied;
		const on = (await request.formData()).get('on') === 'on';
		await setVoiceLearn(await kitchenOf(locals.user!.id), on);
		return { saved: 'voiceLearn' };
	},
	/** Oración (#339), on or off. */
	savePrayerMode: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'prayerProblem');
		if (denied) return denied;
		const on = (await request.formData()).get('on') === 'on';
		await setPrayerMode(await kitchenOf(locals.user!.id), on);
		return { saved: 'prayerMode' };
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
	/** «Lo que la voz recuerda»: one more, theirs or the house's. */
	addMemory: async ({ request, locals }) => {
		const form = await request.formData();
		const text = String(form.get('text') ?? '');
		if (!text.trim()) return fail(400, { memoryProblem: 'Escribe qué tiene que recordar' });
		await remember(
			await kitchenOf(locals.user!.id),
			form.get('whose') === 'house' ? null : locals.user!.id,
			text,
			{ untilDay: String(form.get('until') ?? '') || null }
		);
		return { saved: 'memory' };
	},
	/** «Reglas» (#331): a new one, or (with `id`) one said again, understood by the AI. */
	saveRule: async ({ request, locals }) => {
		const form = await request.formData();
		const said = String(form.get('text') ?? '');
		const id = form.get('id') ? Number(form.get('id')) : null;
		if (!said.trim()) return fail(400, { ruleProblem: 'Escribe la regla', ruleId: id });
		const k = await kitchenOf(locals.user!.id);
		const made = await translateRule(k, said, locals.user!.name);
		if ('problem' in made) return fail(400, { ruleProblem: made.problem, ruleId: id });
		const whose = form.get('whose') === 'house' ? null : locals.user!.id;
		const saved = await saveRule(
			k,
			id === null ? whose : locals.user!.id,
			said,
			made.understood,
			made.spec,
			Number.isInteger(id) ? id : null
		);
		if (!saved)
			return fail(400, { ruleProblem: 'Ya hay demasiadas reglas en la familia', ruleId: id });
		return { saved: 'rule', ruleId: saved };
	},
	/** One ready (#331, phase 7), turned on: its rules, theirs. */
	activateTemplate: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') ?? '');
		const template = RULE_TEMPLATES.find((t) => t.id === id);
		if (!template) return fail(400, { ruleProblem: 'Esa regla lista no existe', ruleId: null });
		const k = await kitchenOf(locals.user!.id);
		for (const r of template.rules)
			if (!(await saveRule(k, locals.user!.id, r.said, r.understood, { ...r.spec, template: id })))
				return fail(400, { ruleProblem: 'Ya hay demasiadas reglas en la familia', ruleId: null });
		return { saved: 'rule' };
	},
	/** «Pausar» and «Seguir». */
	pauseRule: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (Number.isInteger(id))
			await setRulePaused(
				await kitchenOf(locals.user!.id),
				locals.user!.id,
				id,
				form.get('paused') === 'true'
			);
		return { saved: 'rule' };
	},
	/** «Probar»: what it would do now. */
	tryRule: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		const said = Number.isInteger(id)
			? await tryRule(await kitchenOf(locals.user!.id), locals.user!.id, id)
			: null;
		return { ruleTried: { id, said: said ?? 'Esa regla ya no está.' } };
	},
	deleteRule: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (Number.isInteger(id))
			await deleteRule(await kitchenOf(locals.user!.id), locals.user!.id, id);
		return { saved: 'rule' };
	},
	/** And one forgotten: theirs, or the house's. */
	/** One changed: its words and its last day (theirs, or the house's). */
	editMemory: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const text = String(form.get('text') ?? '');
		if (!Number.isInteger(id) || !text.trim())
			return fail(400, { memoryProblem: 'Escribe qué tiene que recordar' });
		await editMemory(
			await kitchenOf(locals.user!.id),
			locals.user!.id,
			id,
			text,
			String(form.get('until') ?? '') || null
		);
		return { saved: 'memory' };
	},
	forgetMemory: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (Number.isInteger(id)) await forget(await kitchenOf(locals.user!.id), locals.user!.id, id);
		return { saved: 'memory' };
	},
	/** One of «Costumbres de la voz», forgotten. */
	forgetVoiceLearned: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'voiceProblem');
		if (denied) return denied;
		const id = Number((await request.formData()).get('id'));
		if (Number.isInteger(id)) await forgetLearned(await kitchenOf(locals.user!.id), id);
		return { saved: 'voiceLearned' };
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
	/** Someone into the family, by an email with its link (invitations.ts). */
	invite: async ({ request, locals }) => {
		const familyId = await adminFamily(locals.user!.id);
		if (!familyId) return fail(403, { inviteProblem: 'Solo quien administra la familia' });
		const form = await request.formData();
		const email = String(form.get('email') ?? '')
			.trim()
			.slice(0, 200);
		if (!EMAIL.test(email)) return fail(400, { inviteProblem: 'Ese email no parece válido' });
		const familyName = await withFamily(locals.user!.id, async (tx) => {
			const [f] = await tx
				.select({ name: family.name })
				.from(family)
				.where(eq(family.id, familyId));
			return f.name;
		});
		const done = await inviteAndSend({
			email,
			familyId,
			familyName,
			role: form.get('admin') === 'on' ? 'admin' : 'member',
			inviter: locals.user!
		});
		if (!done.ok) return fail(400, { inviteProblem: done.problem });
		return { invited: { email, sent: done.sent, link: done.link } };
	},
	cancelInvitation: async ({ request, locals }) => {
		const familyId = await adminFamily(locals.user!.id);
		if (!familyId) return fail(403, { inviteProblem: 'Solo quien administra la familia' });
		await invitations.cancel(String((await request.formData()).get('id') ?? ''), familyId);
		return { saved: 'invitation-cancelled' };
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
	/** A person without an account, a child's (#303): who lets it in, the adults ticked. */
	giveKidAccount: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'personProblem');
		if (denied) return denied;
		const form = await request.formData();
		const done = await giveKidAccount(
			await kitchenOf(locals.user!.id),
			Number(form.get('id')),
			form.getAll('guardian').map(String)
		);
		if (!done) return fail(400, { personProblem: 'Esa persona ya tiene cuenta o no está' });
		return { saved: 'kid' };
	},
	saveGuardians: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'personProblem');
		if (denied) return denied;
		const form = await request.formData();
		const done = await setGuardians(
			await kitchenOf(locals.user!.id),
			String(form.get('kidId') ?? ''),
			form.getAll('guardian').map(String)
		);
		if (!done) return fail(400, { personProblem: 'Ese peque no está' });
		return { saved: 'kid' };
	},
	/** This device, the children's (#303): «¿Quién eres?» on entering, from now on. */
	trustKidDevice: async ({ request, locals, cookies }) => {
		const denied = await requireAdmin(locals.user!.id, 'kidDeviceProblem');
		if (denied) return denied;
		const name = String((await request.formData()).get('name') ?? '')
			.trim()
			.slice(0, 40);
		if (!name) return fail(400, { kidDeviceProblem: 'Ponle un nombre' });
		await trustDevice(await kitchenOf(locals.user!.id), cookies, name);
		return { saved: 'kidDevice' };
	},
	untrustKidDevice: async ({ locals, cookies }) => {
		const denied = await requireAdmin(locals.user!.id, 'kidDeviceProblem');
		if (denied) return denied;
		await untrustThisDevice(await kitchenOf(locals.user!.id), cookies);
		return { saved: 'kidDevice' };
	},
	forgetKidDevice: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'kidDeviceProblem');
		if (denied) return denied;
		const id = Number((await request.formData()).get('id'));
		await forgetDevice(await kitchenOf(locals.user!.id), id);
		return { saved: 'kidDevice' };
	},
	/** Back to a person without an account: its name, drawing and agenda stay. */
	takeKidAccount: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'personProblem');
		if (denied) return denied;
		const kidId = String((await request.formData()).get('kidId') ?? '');
		if (!(await takeKidAccount(await kitchenOf(locals.user!.id), kidId)))
			return fail(400, { personProblem: 'Ese peque no está' });
		return { saved: 'kid' };
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
					'Esa no es una clave de jellycartoon: empiezan por casita_ (Ajustes → Casa → «Seilide»)'
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
	/**
	 * «Entrar con la nube» (#279): a client of the cloud's OpenID provider for the house, at its
	 * address; its secret shown once, to go into the house's .env.
	 */
	createHouseClient: async ({ request, locals }) => {
		const familyId = await adminFamily(locals.user!.id);
		if (!familyId) return fail(403, { clientProblem: 'Solo quien administra la familia' });
		let houseUrl: URL;
		try {
			houseUrl = new URL(String((await request.formData()).get('url') ?? '').trim());
		} catch {
			return fail(400, { clientProblem: 'Escribe la dirección completa, con https://' });
		}
		try {
			return { houseClient: await createHouseClient(request.headers, houseUrl.origin, familyId) };
		} catch (error) {
			// Its address, refused by the provider: https, unless on this same machine.
			if (refusedByProvider(error))
				return fail(400, { clientProblem: 'La dirección de la casa, con https://' });
			throw error;
		}
	},
	deleteHouseClient: async ({ request, locals }) => {
		const familyId = await adminFamily(locals.user!.id);
		if (!familyId) return fail(403, { clientProblem: 'Solo quien administra la familia' });
		await deleteHouseClient(request.headers, String((await request.formData()).get('id') ?? ''));
		return { saved: 'house-client-out' };
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
	/** A voice satellite of Seilide's (#296): its key, shown once. */
	createSatellite: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'satelliteProblem');
		if (denied) return denied;
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { satelliteProblem: 'Ponle un nombre: «dormitorio»' });
		if (name.length > MAX_SATELLITE_NAME)
			return fail(400, { satelliteProblem: `Hasta ${MAX_SATELLITE_NAME} letras` });
		return {
			satelliteKey: await createSatellite(locals.user!.id, name),
			satelliteName: name
		};
	},
	/** «Voz de los satélites»: the voice, its tone and the phrases; their recordings, made now. */
	saveSatelliteVoice: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'satelliteVoiceProblem');
		if (denied) return denied;
		const form = await request.formData();
		const k = await kitchenOf(locals.user!.id);
		await setSatelliteVoice(k, await openRouterKey(k), {
			voice: String(form.get('voice') ?? ''),
			tone: String(form.get('tone') ?? ''),
			fillers: String(form.get('fillers') ?? '')
		});
		return { saved: 'satelliteVoice' };
	},
	/** Its snapserver (the house's music in its room), or none: told to it at once. */
	saveSnapserver: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'satelliteProblem');
		if (denied) return denied;
		const form = await request.formData();
		const snapserver = parseSnapserver(String(form.get('snapserver') ?? ''));
		if (snapserver === undefined)
			return fail(400, {
				satelliteProblem: 'El snapserver es una IP o un nombre, con su puerto si no es 1704'
			});
		await setSnapserver(locals.user!.id, String(form.get('id') ?? ''), snapserver);
		return { saved: 'snapserver' };
	},
	deleteSatellite: async ({ request, locals }) => {
		const denied = await requireAdmin(locals.user!.id, 'satelliteProblem');
		if (denied) return denied;
		await deleteSatellite(locals.user!.id, String((await request.formData()).get('id') ?? ''));
		return { saved: 'satellites' };
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
