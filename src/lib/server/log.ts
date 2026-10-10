import { lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { logEntry } from '#lib/server/db/schema.ts';

type Level = (typeof logEntry.$inferInsert)['level'];

const KEEP_DAYS = 30;

/** Errors don't survive JSON on their own: keeps their message and stack (ffmpeg's output is in the message). */
function serialize(details: Record<string, unknown>) {
	return JSON.parse(
		JSON.stringify(details, (_key, value) =>
			value instanceof Error ? { message: value.message, stack: value.stack } : value
		)
	) as Record<string, unknown>;
}

/**
 * Writes to the console (still in `docker logs`) and to the log_entry table (shown in /logs).
 * Never throws nor waits: logging must not break or slow down what is being logged.
 */
function write(level: Level, source: string, message: string, details?: Record<string, unknown>) {
	const print = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
	print(`[${source}] ${message}`, ...(details ? [details] : []));

	db.insert(logEntry)
		.values({ level, source, message, details: details ? serialize(details) : null })
		.catch((error) => console.error('[log] no se pudo guardar', error));
}

export const log = {
	info: (source: string, message: string, details?: Record<string, unknown>) =>
		write('info', source, message, details),
	warn: (source: string, message: string, details?: Record<string, unknown>) =>
		write('warn', source, message, details),
	error: (source: string, message: string, details?: Record<string, unknown>) =>
		write('error', source, message, details)
};

async function deleteOld() {
	await db
		.delete(logEntry)
		.where(lt(logEntry.at, sql`now() - make_interval(days => ${KEEP_DAYS})`))
		.catch((error) => console.error('[log] no se pudieron borrar los antiguos', error));
}

/** Deletes entries older than KEEP_DAYS now and then once a day. */
export function startLogCleanup() {
	deleteOld();
	setInterval(deleteOld, 24 * 60 * 60 * 1000).unref();
}
