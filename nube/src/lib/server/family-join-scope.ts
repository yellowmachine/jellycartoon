import { and, eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
	alarm,
	alarmPerson,
	bill,
	calendarEvent,
	calendarEventPerson,
	car,
	carDriver,
	expense,
	expenseFavorite,
	expenseLine,
	expenseNotDuplicate,
	family,
	familyMember,
	familyPerson,
	fridgeItem,
	fridgeNote,
	heard,
	house,
	houseKey,
	inbox,
	chatMessage,
	income,
	invitation,
	medication,
	medicationDose,
	call,
	memory,
	note,
	oauthClient,
	paper,
	paperEvent,
	paperPerson,
	plannedLeg,
	plannedTrip,
	plannedTripPerson,
	podcast,
	podcastEpisode,
	podcastProgress,
	podcastSubscription,
	prayer,
	prayerList,
	prayerListItem,
	prayerVoice,
	pushSubscription,
	recipe,
	recipeSite,
	recipeSitePage,
	recipeSiteSitemap,
	recurringExpense,
	recurringIncome,
	rule,
	savedPlace,
	savedRoute,
	trip,
	tripPhoto,
	voiceSatellite,
	walk,
	walkPhoto,
	walkShare,
	watchLog
} from './db/schema.ts';
import { setFamily, Stopped } from './family-move-scope.ts';
import type { AnyDb } from './family-scope.ts';
import { openFileFor, openFor, sealFileFor, sealFor } from './family-secret.ts';
import { invitationStatus } from '../invitation.ts';
import { PAPERS_AREA_NAME, PERSON_DATA } from './person-data.ts';
import * as realStorage from './storage.ts';

/**
 * A family of one joining another with its invitation (#315): all of it goes to the new one, and it
 * goes. As family-move-scope.ts, on the app's own role: read and deleted in the old family, then
 * written in the new one, each row with its id. Everything in it was theirs, so what had no person
 * (the house's) becomes theirs too, not the new family's whole.
 */

/** In the order they can be written: each after what it points at. */
const TABLES: [string, PgTable][] = [
	['family_person', familyPerson],
	['recurring_expense', recurringExpense],
	['expense', expense],
	['expense_line', expenseLine],
	['bill', bill],
	['expense_not_duplicate', expenseNotDuplicate],
	['expense_favorite', expenseFavorite],
	['recurring_income', recurringIncome],
	['income', income],
	['fridge_note', fridgeNote],
	['fridge_item', fridgeItem],
	['recipe', recipe],
	['recipe_site', recipeSite],
	['recipe_site_page', recipeSitePage],
	['recipe_site_sitemap', recipeSiteSitemap],
	['calendar_event', calendarEvent],
	['calendar_event_person', calendarEventPerson],
	['alarm', alarm],
	['alarm_person', alarmPerson],
	['push_subscription', pushSubscription],
	['medication', medication],
	['medication_dose', medicationDose],
	// Their calls, of a family of one: with no one else in it, their own history (#330).
	['call', call],
	['paper', paper],
	['paper_person', paperPerson],
	['paper_event', paperEvent],
	['car', car],
	['car_driver', carDriver],
	['trip', trip],
	['trip_photo', tripPhoto],
	['saved_place', savedPlace],
	['saved_route', savedRoute],
	['planned_trip', plannedTrip],
	['planned_trip_person', plannedTripPerson],
	['planned_leg', plannedLeg],
	['walk', walk],
	['walk_photo', walkPhoto],
	['walk_share', walkShare],
	['note', note],
	['watch_log', watchLog],
	['rule', rule],
	['memory', memory],
	['heard', heard],
	['inbox', inbox],
	['chat_message', chatMessage],
	['podcast', podcast],
	['podcast_episode', podcastEpisode],
	['podcast_subscription', podcastSubscription],
	['podcast_progress', podcastProgress],
	['prayer_voice', prayerVoice],
	['prayer', prayer],
	['prayer_list', prayerList],
	['prayer_list_item', prayerListItem]
];

export const JOINED_TABLES = TABLES.map(([name]) => name);

/** Without a person, the house's: in a family of one, theirs; never the new family's whole. */
const BECOME_THEIRS = new Set(['memory', 'rule', 'heard', 'note']);

type Row = Record<string, unknown>;

export type JoinState =
	/** Not their case: an invitation to make a family, or they have none yet. */
	{ kind: 'none' } | { kind: 'canJoin'; familyName: string } | { kind: 'blocked'; problem: string };

export type MoveFilesForJoin = Pick<
	typeof realStorage,
	'copyFile' | 'putFile' | 'readFile' | 'removeAllFiles' | 'removeFile' | 'listFiles'
>;

/** Where the families' files are that go, and the sealed ones apart (`PAPERS_AREA_NAME`). */
const areas = () => {
	const found = new Set<string>();
	for (const { zip } of Object.values(PERSON_DATA))
		if (zip && zip.stored && !zip.stored.sealed) found.add(zip.stored.area);
	return [...found];
};

export function familyJoinScope(
	db: AnyDb,
	{ role, storage = realStorage }: { role?: string; storage?: MoveFilesForJoin } = {}
) {
	const inTx = <T>(userId: string, fn: (tx: AnyDb) => Promise<T>) =>
		db.transaction(async (tx) => {
			if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
			await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
			return fn(tx as unknown as AnyDb);
		});

	/** Why they cannot, in the family in `app.family_id`; null, they can. */
	async function whyNot(tx: AnyDb, userId: string) {
		const members = await tx.select({ id: familyMember.userId }).from(familyMember);
		if (members.some((m) => m.id !== userId))
			return 'Para unirte, primero sal de tu familia, en Ajustes → Cuenta. Con más gente en ella, no se puede llevar todo';
		const [connected] = await tx.select({ id: house.familyId }).from(house);
		const [key] = await tx.select({ id: houseKey.id }).from(houseKey);
		const [satellite] = await tx.select({ id: voiceSatellite.id }).from(voiceSatellite);
		if (connected || key || satellite)
			return 'Tu familia tiene una casa o satélites conectados: desconéctalos antes en Ajustes → Conexiones';
		return null;
	}

	/** What this invitation means for them, to say it before they accept it. */
	async function stateOf(token: string, userId: string): Promise<JoinState> {
		return inTx(userId, async (tx) => {
			const [inv] = await tx.select().from(invitation).where(eq(invitation.token, token));
			const [mine] = await tx
				.select({ familyId: familyMember.familyId })
				.from(familyMember)
				.where(eq(familyMember.userId, userId));
			if (!inv?.familyId || !mine) return { kind: 'none' };
			if (mine.familyId === inv.familyId)
				return { kind: 'blocked', problem: 'Ya estás en esta familia' };
			await setFamily(tx, mine.familyId);
			const problem = await whyNot(tx, userId);
			if (problem) return { kind: 'blocked', problem };
			const [f] = await tx.select({ name: family.name }).from(family);
			return { kind: 'canJoin', familyName: f.name };
		});
	}

	/** Accepted: all theirs to its family. */
	async function join(
		token: string,
		who: { id: string; email: string }
	): Promise<{ ok: true; familyId: string } | { ok: false; problem: string }> {
		const userId = who.id;
		const state = await stateOf(token, userId);
		if (state.kind === 'blocked') return { ok: false, problem: state.problem };
		if (state.kind === 'none') return { ok: false, problem: 'Esta invitación no es para unirse' };

		const { from, to } = await inTx(userId, async (tx) => {
			const [inv] = await tx
				.select({ familyId: invitation.familyId })
				.from(invitation)
				.where(eq(invitation.token, token));
			const [mine] = await tx
				.select({ familyId: familyMember.familyId })
				.from(familyMember)
				.where(eq(familyMember.userId, userId));
			return { from: mine.familyId, to: inv.familyId! };
		});

		const copied: { area: string; name: string }[] = [];
		try {
			// The files first; the sealed ones, opened and sealed again with the new family's key.
			for (const area of areas())
				for (const name of await storage.listFiles(from, area)) {
					await storage.copyFile(from, to, area, name);
					copied.push({ area, name });
				}
			const papers = await inTx(userId, async (tx) => {
				await setFamily(tx, from);
				return tx.select().from(paper);
			});
			const sealed = new Map<number, { name: string; notes: string | null }>();
			const sealAgain = async (value: string) => {
				const open = await openFor(from, value);
				if (open === null) throw new Stopped('No se pudo abrir un papel');
				return sealFor(to, open);
			};
			for (const p of papers) {
				sealed.set(p.id, {
					name: await sealAgain(p.name),
					notes: p.notes ? await sealAgain(p.notes) : null
				});
				const bytes = await storage.readFile(from, PAPERS_AREA_NAME, p.file);
				if (!bytes) continue;
				const open = await openFileFor(from, bytes);
				if (!open) throw new Stopped('No se pudo abrir el fichero de un papel');
				await storage.putFile(
					to,
					PAPERS_AREA_NAME,
					p.file,
					await sealFileFor(to, open),
					'application/octet-stream'
				);
				copied.push({ area: PAPERS_AREA_NAME, name: p.file });
			}

			await inTx(userId, (tx) => move(tx, { token, who, from, to, sealed }));
		} catch (error) {
			for (const { area, name } of copied)
				await storage
					.removeFile(to, area, name)
					.catch((err) => console.warn('[familias] No se pudo quitar un fichero', String(err)));
			if (error instanceof Stopped) return { ok: false, problem: error.message };
			throw error;
		}
		await storage
			.removeAllFiles(from)
			.catch((err) => console.warn('[familias] No se pudieron quitar los ficheros', String(err)));
		return { ok: true, familyId: to };
	}

	/** The move itself: all of it, or nothing. */
	async function move(
		tx: AnyDb,
		m: {
			token: string;
			who: { id: string; email: string };
			from: string;
			to: string;
			sealed: Map<number, { name: string; notes: string | null }>;
		}
	) {
		const userId = m.who.id;
		// The invitation, and they, locked and looked at again: nothing changed since it was asked.
		const [inv] = await tx
			.select()
			.from(invitation)
			.where(eq(invitation.token, m.token))
			.for('update');
		if (!inv || inv.familyId !== m.to || invitationStatus(inv) !== 'pending')
			throw new Stopped('Esta invitación ya no vale');
		if (inv.email.trim().toLowerCase() !== m.who.email.trim().toLowerCase())
			throw new Stopped(`Esta invitación es para ${inv.email}`);
		await setFamily(tx, m.from);
		const [member] = await tx
			.select()
			.from(familyMember)
			.where(eq(familyMember.userId, userId))
			.for('update');
		if (!member || member.familyId !== m.from) throw new Stopped('Ya no estás en esa familia');
		const problem = await whyNot(tx, userId);
		if (problem) throw new Stopped(problem);

		const rows = new Map<string, Row[]>();
		for (const [name, table] of TABLES) rows.set(name, (await tx.select().from(table)) as Row[]);
		const of = (name: string) => rows.get(name) ?? [];

		// Papers added since they were sealed again would be lost: said, and tried again.
		if (of('paper').some((p) => !m.sealed.has(p.id as number)))
			throw new Stopped('Algo ha cambiado mientras tanto. Prueba otra vez');

		// Its family goes, and everything in it with it; its house's way in, if it had one, too.
		await tx.delete(family).where(eq(family.id, m.from));
		await tx.delete(oauthClient).where(eq(oauthClient.referenceId, m.from));

		await setFamily(tx, m.to);
		const familyId = m.to;
		await tx.insert(familyMember).values({ ...member, familyId, role: inv.role });

		// What the new family already has one of: its own is kept, and theirs points at it.
		const feeds = new Map(
			(await tx.select({ id: podcast.id, feedUrl: podcast.feedUrl }).from(podcast)).map((p) => [
				p.feedUrl,
				p.id
			])
		);
		const sameShow = new Map<number, number>();
		for (const show of of('podcast')) {
			const already = feeds.get(show.feedUrl as string);
			if (already) sameShow.set(show.id as number, already);
		}
		const episodes = new Map(
			(await tx.select().from(podcastEpisode)).map((e) => [`${e.podcastId}/${e.guid}`, e.id])
		);
		const sameEpisode = new Map<number, number>();
		for (const episode of of('podcast_episode')) {
			const show = sameShow.get(episode.podcastId as number);
			const already = show && episodes.get(`${show}/${episode.guid}`);
			if (already) sameEpisode.set(episode.id as number, already);
		}
		const hosts = new Set(
			(await tx.select({ host: recipeSite.host }).from(recipeSite)).map((s) => s.host)
		);
		const sameSite = new Set(
			of('recipe_site')
				.filter((s) => hosts.has(s.host as string))
				.map((s) => s.id as number)
		);
		const urls = new Set(
			(await tx.select({ url: recipe.sourceUrl }).from(recipe)).map((r) => r.url)
		);

		// A call with the new family while linked (#464): it already has its own row of it.
		const calls = new Set((await tx.select({ id: call.id }).from(call)).map((c) => c.id));

		const skip: Record<string, (row: Row) => boolean> = {
			call: (r) => calls.has(r.id as string),
			podcast: (r) => sameShow.has(r.id as number),
			podcast_episode: (r) => sameEpisode.has(r.id as number),
			recipe: (r) => urls.has(r.sourceUrl as string),
			recipe_site: (r) => sameSite.has(r.id as number),
			recipe_site_page: (r) => sameSite.has(r.siteId as number),
			recipe_site_sitemap: (r) => sameSite.has(r.siteId as number)
		};
		const change: Record<string, (row: Row) => Row> = {
			paper: (r) => ({ ...m.sealed.get(r.id as number) }),
			alarm: () => ({ place: 'movil', ringingSince: null }),
			podcast_episode: (r) => ({
				podcastId: sameShow.get(r.podcastId as number) ?? r.podcastId
			}),
			podcast_subscription: (r) => ({
				podcastId: sameShow.get(r.podcastId as number) ?? r.podcastId
			}),
			podcast_progress: (r) => ({
				episodeId: sameEpisode.get(r.episodeId as number) ?? r.episodeId
			})
		};
		for (const [name, table] of TABLES)
			for (const row of of(name)) {
				if (skip[name]?.(row)) continue;
				const values: Row = { ...row, familyId, ...change[name]?.(row) };
				if (BECOME_THEIRS.has(name)) values.userId = userId;
				await tx.insert(table).values(values as never);
			}

		// What was for no one, in the family they had alone, was for them: here, it is for them.
		const [me] = await tx
			.select({ id: familyPerson.id })
			.from(familyPerson)
			.where(and(eq(familyPerson.userId, userId), eq(familyPerson.familyId, familyId)));
		if (me) {
			const withPeople = new Set(of('calendar_event_person').map((r) => r.eventId));
			for (const event of of('calendar_event'))
				if (!withPeople.has(event.id))
					await tx
						.insert(calendarEventPerson)
						.values({ familyId, eventId: event.id as number, personId: me.id });
			const ringing = new Set(of('alarm_person').map((r) => r.alarmId));
			for (const row of of('alarm'))
				if (!ringing.has(row.id))
					await tx
						.insert(alarmPerson)
						.values({ familyId, alarmId: row.id as number, personId: me.id });
		}

		await tx.update(invitation).set({ usedAt: new Date() }).where(eq(invitation.id, inv.id));
	}

	return { stateOf, join };
}
