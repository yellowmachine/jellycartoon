import { and, desc, eq, gte, ilike, inArray, lt, type SQL } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { logEntry } from '#lib/server/db/schema.ts';

const PAGE_SIZE = 100;

/** `warn` shows warnings and errors; `error`, only errors. */
const LEVELS = { warn: ['warn', 'error'], error: ['error'] } as const;

const formatAt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'medium' });

export const load: PageServerLoad = async ({ url }) => {
	const level = url.searchParams.get('level') ?? '';
	const source = url.searchParams.get('source') ?? '';
	const q = url.searchParams.get('q')?.trim() ?? '';
	const day = url.searchParams.get('day') ?? '';
	const before = Number(url.searchParams.get('before')) || null;

	const where: SQL[] = [];
	if (level in LEVELS)
		where.push(inArray(logEntry.level, [...LEVELS[level as keyof typeof LEVELS]]));
	if (source) where.push(eq(logEntry.source, source));
	// The user's text is literal: % and _ are not wildcards.
	if (q) where.push(ilike(logEntry.message, `%${q.replace(/[\\%_]/g, '\\$&')}%`));
	if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
		// Midnight in the server's time zone (TZ), like the times shown.
		const start = new Date(`${day}T00:00:00`);
		const end = new Date(start);
		end.setDate(end.getDate() + 1);
		where.push(gte(logEntry.at, start), lt(logEntry.at, end));
	}
	if (before) where.push(lt(logEntry.id, before));

	const [rows, sources] = await Promise.all([
		db
			.select()
			.from(logEntry)
			.where(and(...where))
			.orderBy(desc(logEntry.id))
			.limit(PAGE_SIZE + 1),
		db.selectDistinct({ source: logEntry.source }).from(logEntry).orderBy(logEntry.source)
	]);

	return {
		entries: rows.slice(0, PAGE_SIZE).map((e) => ({ ...e, at: formatAt.format(e.at) })),
		hasMore: rows.length > PAGE_SIZE,
		sources: sources.map((s) => s.source),
		filters: { level, source, q, day, before }
	};
};
