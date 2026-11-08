import { familySettings } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { isPageNoticeKind, type PageNoticeKind } from 'comun/page-notices.ts';

/**
 * «Avisos en las páginas» (#440), the family's: on or off, and the kinds turned off with «No me lo
 * vuelvas a decir». Any adult changes them, as anyone may tap that button.
 */

export async function pageNoticesOf(k: Kitchen) {
	const [row] = await k.run((tx) =>
		tx
			.select({ on: familySettings.pageNotices, off: familySettings.pageNoticesOff })
			.from(familySettings)
	);
	return { on: row?.on ?? true, off: (row?.off ?? []).filter(isPageNoticeKind) };
}

/** Whether that kind is said to this family. */
export async function noticeOn(k: Kitchen, kind: PageNoticeKind) {
	const { on, off } = await pageNoticesOf(k);
	return on && !off.includes(kind);
}

export async function setPageNotices(k: Kitchen, on: boolean) {
	await k.run((tx) =>
		tx
			.insert(familySettings)
			.values({ familyId: k.familyId, pageNotices: on })
			.onConflictDoUpdate({ target: familySettings.familyId, set: { pageNotices: on } })
	);
}

/** That kind said again (`on`), or not («No me lo vuelvas a decir»). */
export async function setNoticeKind(k: Kitchen, kind: PageNoticeKind, on: boolean) {
	const { off } = await pageNoticesOf(k);
	const now = on ? off.filter((o) => o !== kind) : [...new Set([...off, kind])];
	await k.run((tx) =>
		tx
			.insert(familySettings)
			.values({ familyId: k.familyId, pageNoticesOff: now })
			.onConflictDoUpdate({ target: familySettings.familyId, set: { pageNoticesOff: now } })
	);
}
