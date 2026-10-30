import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { admin, isBackupReporter } from '#lib/server/admin.ts';

/** Enough of a run's output to see what went up or what failed. */
const LOG_MAX = 4000;

/**
 * How a night's copy of one of the VPS's apps went (deploy/vps-backup.sh, #320), well or not, with
 * BACKUP_REPORT_TOKEN: `{ name, ok, log }`, for /admin.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!isBackupReporter(request.headers.get('authorization'))) error(401, 'Unauthorized');
	const body: unknown = await request.json().catch(() => null);
	const { name, ok, log } = (body ?? {}) as Record<string, unknown>;
	if (typeof name !== 'string' || !/^[a-z0-9-]{1,40}$/.test(name) || typeof ok !== 'boolean')
		error(400, 'name y ok');
	await admin.recordBackup({
		name,
		ok,
		log: typeof log === 'string' ? log.slice(-LOG_MAX) : ''
	});
	return json({ ok: true });
};
