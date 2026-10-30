import { createHash, timingSafeEqual } from 'node:crypto';
import { BACKUP_REPORT_TOKEN } from '$app/env/private';
import { db } from './db/index.ts';
import { adminScope } from './admin-scope.ts';

/** The service's administrator's view (/admin) and the copies' reports, as the app's role. */
export const admin = adminScope(db);

const digest = (s: string) => createHash('sha256').update(s).digest();

/** The copies' `Authorization: Bearer <BACKUP_REPORT_TOKEN>`; without the variable, none is. */
export function isBackupReporter(authorization: string | null) {
	const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
	return Boolean(
		BACKUP_REPORT_TOKEN && token && timingSafeEqual(digest(token), digest(BACKUP_REPORT_TOKEN))
	);
}
