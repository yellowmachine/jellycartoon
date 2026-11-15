import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import { addDays, localDay } from 'comun/agenda.ts';
import { euros } from 'comun/expenses.ts';
import type { LngLat } from 'comun/road.ts';
import { metresBetween } from 'comun/road-guide.ts';
import { pastWeather } from 'comun/weather.ts';
import { dayForVoice } from '#lib/server/agenda/agenda.ts';
import { spendingBars } from '#lib/server/blocks.ts';
import { report, savedPlace, trip, tripPhoto, walk, walkPhoto } from '#lib/server/db/schema.ts';
import { searchExpenses } from '#lib/server/expenses/expenses.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { listPlannedTrips } from '#lib/server/trips/planned.ts';
import {
	isReportBlockKind,
	keptExpenses,
	MAX_PIECE_TEXT,
	MAX_PIECES,
	REPORT_BLOCKS,
	REPORT_DAYS,
	REPORT_PHOTOS,
	type PhotoRef,
	type Report,
	type ReportBlock,
	type ReportBlockKind,
	type ReportPiece,
	type ReportSummary
} from '#lib/reports.ts';

/**
 * Informes (#505, phase 3): a report's blocks, each taken from the database for its days with what
 * its person sees (their drives, walks, photos; the family's expenses and agenda), kept as they
 * were; the AI only chose them and wrote the words between. Only their person's reports.
 */

/** Points of a way on the map, at most: enough to draw it, not every 25 m. */
const WAY_POINTS = 400;
/** Where they went is the place farthest from where the first drive started, if this far. */
const AWAY_METRES = 30_000;

const isDay = (v: unknown): v is string =>
	typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const daysBetween = (from: string, to: string) =>
	Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
const within = (from: string, to: string) => ({
	since: new Date(`${from}T00:00:00`),
	until: new Date(`${to}T23:59:59.999`)
});

/** One point in every few, the ends kept. */
export function thin(line: [number, number, number][], most = WAY_POINTS): [number, number][] {
	const step = Math.max(1, Math.ceil(line.length / most));
	const kept = line.filter((_, i) => i % step === 0 || i === line.length - 1);
	return kept.map((p) => [p[0], p[1]]);
}

/** What one person did those days: their drives and walks, with their ways, and photos. */
async function movesOf(k: Kitchen, userId: string, from: string, to: string) {
	const { since, until } = within(from, to);
	const [drives, walks, photos, walkPhotos] = await Promise.all([
		k.run((tx) =>
			tx
				.select({
					id: trip.id,
					startedAt: trip.startedAt,
					distance: trip.distance,
					destination: trip.destination,
					line: trip.line
				})
				.from(trip)
				.where(and(eq(trip.userId, userId), gte(trip.startedAt, since), lte(trip.startedAt, until)))
				.orderBy(asc(trip.startedAt))
		),
		k.run((tx) =>
			tx
				.select({
					id: walk.id,
					startedAt: walk.startedAt,
					distance: walk.distance,
					line: walk.line
				})
				.from(walk)
				.where(and(eq(walk.userId, userId), gte(walk.startedAt, since), lte(walk.startedAt, until)))
				.orderBy(asc(walk.startedAt))
		),
		k.run((tx) =>
			tx
				.select({ id: tripPhoto.id, at: tripPhoto.takenAt, lon: tripPhoto.lon, lat: tripPhoto.lat })
				.from(tripPhoto)
				.where(
					and(
						eq(tripPhoto.userId, userId),
						gte(tripPhoto.takenAt, since),
						lte(tripPhoto.takenAt, until)
					)
				)
				.orderBy(asc(tripPhoto.takenAt))
		),
		k.run((tx) =>
			tx
				.select({ id: walkPhoto.id, at: walkPhoto.at })
				.from(walkPhoto)
				.where(
					and(eq(walkPhoto.userId, userId), gte(walkPhoto.at, since), lte(walkPhoto.at, until))
				)
				.orderBy(asc(walkPhoto.at))
		)
	]);
	return { drives, walks, photos, walkPhotos };
}

/**
 * Where they were those days, for its weather: the drives' end farthest from where the first one
 * started (named by its route or a place kept near it); else the end of a planned trip of theirs
 * on those days. Null, nowhere known.
 */
async function whereWas(
	k: Kitchen,
	userId: string,
	from: string,
	to: string,
	drives: { destination: string | null; line: [number, number, number][] }[]
): Promise<{ at: LngLat; name: string | null } | null> {
	const start = drives[0]?.line[0];
	let far: { at: LngLat; name: string | null; metres: number } | null = null;
	if (start)
		for (const d of drives) {
			const end = d.line.at(-1);
			if (!end) continue;
			const metres = metresBetween([start[0], start[1]], [end[0], end[1]]);
			if (metres >= AWAY_METRES && (!far || metres > far.metres))
				far = { at: [end[0], end[1]], name: d.destination, metres };
		}
	if (far) {
		if (!far.name) {
			const places = await k.run((tx) =>
				tx
					.select({ name: savedPlace.name, lon: savedPlace.lon, lat: savedPlace.lat })
					.from(savedPlace)
					.where(eq(savedPlace.userId, userId))
			);
			far.name = places.find((p) => metresBetween([p.lon, p.lat], far!.at) <= 2_000)?.name ?? null;
		}
		return { at: far.at, name: far.name };
	}
	const planned = await listPlannedTrips(k);
	for (const t of planned) {
		const leg = t.legs.find((l) => l.day >= from && l.day <= to);
		if (leg) return { at: leg.end, name: leg.to };
	}
	return null;
}

/** One block for those days: its figures as they are now, or why there is nothing to show. */
export async function buildBlock(
	k: Kitchen,
	userId: string,
	kind: ReportBlockKind,
	from: string,
	to: string
): Promise<ReportBlock | string> {
	switch (kind) {
		case 'cifras': {
			const [m, expenses] = await Promise.all([
				movesOf(k, userId, from, to),
				searchExpenses(k, { text: '', from, to }, { limit: null })
			]);
			return {
				kind: 'cifras',
				days: daysBetween(from, to),
				driven: m.drives.reduce((s, d) => s + d.distance, 0),
				drives: m.drives.length,
				walked: m.walks.reduce((s, w) => s + w.distance, 0),
				walks: m.walks.length,
				photos: m.photos.length + m.walkPhotos.length,
				expenses: expenses.filter((e) => !e.fixed).map((e) => ({ id: e.id, total: e.total }))
			};
		}
		case 'mapa': {
			const m = await movesOf(k, userId, from, to);
			const ways = [...m.drives, ...m.walks].map((d) => thin(d.line)).filter((w) => w.length > 1);
			if (!ways.length) return 'No hay trayectos ni paseos grabados esos días.';
			return {
				kind: 'mapa',
				ways,
				photos: m.photos.map((p) => ({ id: p.id, lon: p.lon, lat: p.lat })),
				moves: [
					...m.drives.map((d) => ({
						from: 'viaje' as const,
						id: d.id,
						at: d.startedAt.toISOString(),
						distance: d.distance,
						destination: d.destination
					})),
					...m.walks.map((w) => ({
						from: 'paseo' as const,
						id: w.id,
						at: w.startedAt.toISOString(),
						distance: w.distance,
						destination: null
					}))
				].sort((a, b) => a.at.localeCompare(b.at))
			};
		}
		case 'fotos': {
			const m = await movesOf(k, userId, from, to);
			const all: PhotoRef[] = [
				...m.photos.map((p) => ({ from: 'viaje' as const, id: p.id, at: p.at.toISOString() })),
				...m.walkPhotos.map((p) => ({ from: 'paseo' as const, id: p.id, at: p.at.toISOString() }))
			].sort((a, b) => a.at.localeCompare(b.at));
			if (!all.length) return 'No hay fotos esos días.';
			return {
				kind: 'fotos',
				photos: all.slice(0, REPORT_PHOTOS),
				more: Math.max(0, all.length - REPORT_PHOTOS)
			};
		}
		case 'gastos': {
			const found = await searchExpenses(k, { text: '', from, to }, { limit: null });
			const items = found
				.filter((e) => !e.fixed)
				.map((e) => ({
					id: e.id,
					date: e.date,
					store: e.store,
					total: e.total,
					category: e.category
				}))
				.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
			if (!items.length) return 'No hay gastos apuntados esos días.';
			return { kind: 'gastos', items };
		}
		case 'barras': {
			const block = await spendingBars(k, from.slice(0, 7), to.slice(0, 7), null);
			return block;
		}
		case 'agenda': {
			const days: { day: string; events: string[] }[] = [];
			for (let day = from; day <= to; day = addDays(day, 1)) {
				const events = await dayForVoice(k, day);
				if (events.length) days.push({ day, events });
			}
			if (!days.length) return 'Nada apuntado en la agenda esos días.';
			return { kind: 'agenda', days };
		}
		case 'tiempo': {
			const { drives } = await movesOf(k, userId, from, to);
			const where = await whereWas(k, userId, from, to, drives);
			if (!where)
				return 'No sé dónde se estuvo esos días: sin trayectos grabados ni viaje planeado.';
			const last = to < localDay() ? to : localDay();
			if (from > last) return 'Esos días aún no han llegado.';
			const days = await pastWeather(where.at[1], where.at[0], from, last).catch((err) => {
				console.warn(`[informes] Sin el tiempo: ${err instanceof Error ? err.message : err}`);
				return null;
			});
			if (!days?.length) return 'No se pudo saber el tiempo que hizo.';
			return { kind: 'tiempo', place: where.name, days };
		}
	}
}

/** A block in words, for the AI to comment on: its figures, never more. */
export function describePiece(p: ReportPiece, excluded: number[] = []): string {
	if (!p.kind) return '';
	const b = p.block;
	if (!b) return `[${p.kind}: ${p.empty}]`;
	switch (b.kind) {
		case 'cifras': {
			const spent = keptExpenses(b.expenses, excluded).reduce((s, e) => s + e.total, 0);
			return `[cifras: ${b.days} días, ${Math.round(b.driven / 1000)} km en ${b.drives} trayectos, ${b.walks} paseos (${Math.round(b.walked / 1000)} km), ${b.photos} fotos, ${euros(spent)} gastados]`;
		}
		case 'mapa':
			return `[mapa: ${b.ways.length} recorridos, ${b.photos.length} fotos situadas]`;
		case 'fotos':
			return `[fotos: ${b.photos.length + b.more}]`;
		case 'gastos': {
			const kept = keptExpenses(b.items, excluded);
			const sums = [...Map.groupBy(kept, (e) => e.category)]
				.map(([c, list]) => [c, list.reduce((s, e) => s + e.total, 0)] as const)
				.sort((a, b) => b[1] - a[1]);
			return `[gastos: ${kept.length}, ${sums.map(([c, t]) => `${c} ${euros(t)}`).join(', ')}]`;
		}
		case 'barras':
			return `[gráfica: ${b.title}]`;
		case 'agenda':
			return `[agenda: ${b.days.map((d) => `${d.day} ${d.events.join('; ')}`).join(' | ')}]`;
		case 'tiempo':
			return `[tiempo${b.place ? ` en ${b.place}` : ''}: ${b.days.map((d) => `${d.day} ${d.sky} ${d.min}–${d.max} °C${d.rain ? ` ${d.rain} mm` : ''}`).join('; ')}]`;
	}
}

/** The pieces' blocks taken now; the words as they were. */
async function fill(
	k: Kitchen,
	userId: string,
	pieces: { text: string; kind: ReportBlockKind | null }[],
	from: string,
	to: string
): Promise<ReportPiece[]> {
	return Promise.all(
		pieces.map(async (p) => {
			if (!p.kind) return { text: p.text, kind: null, block: null, empty: null };
			const built = await buildBlock(k, userId, p.kind, from, to);
			return typeof built === 'string'
				? { text: p.text, kind: p.kind, block: null, empty: built }
				: { text: p.text, kind: p.kind, block: built, empty: null };
		})
	);
}

const toSummary = (r: typeof report.$inferSelect): ReportSummary => ({
	id: r.id,
	title: r.title,
	from: r.fromDay,
	to: r.toDay,
	createdAt: r.createdAt,
	refreshedAt: r.refreshedAt
});

/**
 * A report asked for in the chat: its title, its days and its pieces as the AI chose them (words
 * and a block of REPORT_BLOCKS), filled and kept. A string, what is wrong (for the AI).
 */
export async function makeReport(
	k: Kitchen,
	userId: string,
	args: Record<string, unknown>
): Promise<Report | string> {
	const title = typeof args.title === 'string' ? args.title.trim().slice(0, 100) : '';
	if (!title) return 'Falta el título.';
	if (!isDay(args.from_day) || !isDay(args.to_day)) return 'Faltan los días, AAAA-MM-DD.';
	const [from, to] =
		args.from_day <= args.to_day ? [args.from_day, args.to_day] : [args.to_day, args.from_day];
	if (daysBetween(from, to) > REPORT_DAYS) return `Como mucho ${REPORT_DAYS} días en un informe.`;
	const asked = Array.isArray(args.pieces) ? args.pieces : [];
	const pieces: { text: string; kind: ReportBlockKind | null }[] = [];
	for (const p of asked.slice(0, MAX_PIECES)) {
		if (!p || typeof p !== 'object') continue;
		const { text, block } = p as Record<string, unknown>;
		const words = typeof text === 'string' ? text.trim().slice(0, MAX_PIECE_TEXT) : '';
		const kind = isReportBlockKind(block) ? block : null;
		if (words || kind) pieces.push({ text: words, kind });
	}
	if (!pieces.some((p) => p.kind))
		return `Un informe lleva al menos un bloque: ${Object.keys(REPORT_BLOCKS).join(', ')}.`;
	const filled = await fill(k, userId, pieces, from, to);
	const [row] = await k.run((tx) =>
		tx
			.insert(report)
			.values({ familyId: k.familyId, userId, title, fromDay: from, toDay: to, pieces: filled })
			.returning()
	);
	return { ...toSummary(row!), pieces: row!.pieces, excluded: row!.excluded };
}

/** Their reports, the newest first. */
export async function listReports(k: Kitchen, userId: string): Promise<ReportSummary[]> {
	const rows = await k.run((tx) =>
		tx.select().from(report).where(eq(report.userId, userId)).orderBy(desc(report.id))
	);
	return rows.map(toSummary);
}

export async function getReport(k: Kitchen, userId: string, id: number): Promise<Report | null> {
	const [row] = await k.run((tx) =>
		tx
			.select()
			.from(report)
			.where(and(eq(report.id, id), eq(report.userId, userId)))
	);
	return row ? { ...toSummary(row), pieces: row.pieces, excluded: row.excluded } : null;
}

/** «Actualizar»: its blocks taken again; the words and the expenses taken away stay. */
export async function refreshReport(k: Kitchen, userId: string, id: number) {
	const current = await getReport(k, userId, id);
	if (!current) return false;
	const pieces = await fill(k, userId, current.pieces, current.from, current.to);
	await k.run((tx) =>
		tx
			.update(report)
			.set({ pieces, refreshedAt: new Date() })
			.where(and(eq(report.id, id), eq(report.userId, userId)))
	);
	return true;
}

/** An expense taken away («no es de este viaje») or put back. */
export async function setExcluded(
	k: Kitchen,
	userId: string,
	id: number,
	expenseId: number,
	out: boolean
) {
	const current = await getReport(k, userId, id);
	if (!current) return false;
	const excluded = out
		? [...new Set([...current.excluded, expenseId])]
		: current.excluded.filter((e) => e !== expenseId);
	await k.run((tx) =>
		tx
			.update(report)
			.set({ excluded })
			.where(and(eq(report.id, id), eq(report.userId, userId)))
	);
	return true;
}

export async function renameReport(k: Kitchen, userId: string, id: number, title: string) {
	const name = title.trim().slice(0, 100);
	if (!name) return false;
	const done = await k.run((tx) =>
		tx
			.update(report)
			.set({ title: name })
			.where(and(eq(report.id, id), eq(report.userId, userId)))
			.returning({ id: report.id })
	);
	return done.length > 0;
}

export async function deleteReport(k: Kitchen, userId: string, id: number) {
	await k.run((tx) => tx.delete(report).where(and(eq(report.id, id), eq(report.userId, userId))));
}
