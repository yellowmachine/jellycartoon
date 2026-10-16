import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { kidSchedule, kidSettings, watchTime } from '#lib/server/db/schema.ts';
import { isKid, isKidAccount, VIDEO_ROUTES } from '#lib/server/kids.ts';
import { today } from '#lib/server/playlist.ts';
import {
	closedText,
	videoTime,
	type KidRules,
	type Moment,
	type VideoTime
} from '#lib/kid-time.ts';

/** A child's schedule and daily limit (#18). */
export async function kidRules(userId: string): Promise<KidRules> {
	const [slots, [settings]] = await Promise.all([
		db
			.select({
				weekday: kidSchedule.weekday,
				startMinute: kidSchedule.startMinute,
				endMinute: kidSchedule.endMinute
			})
			.from(kidSchedule)
			.where(eq(kidSchedule.userId, userId))
			.orderBy(asc(kidSchedule.weekday), asc(kidSchedule.startMinute)),
		db
			.select({ dailyMinutes: kidSettings.dailyMinutes })
			.from(kidSettings)
			.where(eq(kidSettings.userId, userId))
	]);
	return { slots, dailyMinutes: settings?.dailyMinutes ?? null };
}

/** Seconds of video watched today. */
export async function watchedToday(userId: string) {
	const [row] = await db
		.select({ seconds: sql<number>`coalesce(sum(${watchTime.seconds}), 0)::real` })
		.from(watchTime)
		.where(and(eq(watchTime.userId, userId), eq(watchTime.day, today())));
	return row?.seconds ?? 0;
}

/** Now, in the server's time zone (TZ), like `today()`. */
export function now(): Moment {
	const date = new Date();
	return { weekday: (date.getDay() + 6) % 7, minute: date.getHours() * 60 + date.getMinutes() };
}

/** Why this user may not watch video now, to show; null if they may. */
export async function videoClosed(userId: string) {
	const time = await videoAllowed(userId);
	return time.allowed ? null : closedText(time, now().weekday);
}

/** Whether this user may watch video now: always, for an adult. */
export async function videoAllowed(userId: string): Promise<VideoTime> {
	if (!(await isKidAccount(userId))) return { allowed: true, until: null };
	const [rules, watched] = await Promise.all([kidRules(userId), watchedToday(userId)]);
	return videoTime(rules, watched, now());
}

/**
 * Out of a child's time, video in the browser stops (#18): the player's page goes to «/descanso»,
 * and the video's pieces are refused, so what is playing stops within seconds. The living room is
 * stopped from mpv's saves, and playing there refused by its actions.
 */
export async function guardVideoTime(event: RequestEvent) {
	const user = event.locals.user;
	if (!isKid(user) || !event.route.id || !VIDEO_ROUTES.has(event.route.id)) return;
	if ((await videoAllowed(user!.id)).allowed) return;
	if (event.route.id.startsWith('/api/')) error(403, 'Ahora no toca ver vídeos');
	redirect(303, '/descanso');
}
