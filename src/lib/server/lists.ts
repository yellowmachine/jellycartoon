import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	episode,
	episodeTitle,
	series,
	userList,
	userListItem,
	userSettings,
	watchProgress
} from '#lib/server/db/schema.ts';

/** Only episodes that can be played count; the rest stay in the list until they come back. */
const playable = and(eq(episode.status, 'ready'), eq(episode.missing, false));

export async function getLists(userId: string) {
	return db
		.select({
			id: userList.id,
			name: userList.name,
			total: sql<number>`count(${episode.id})::int`,
			pending: sql<number>`count(${episode.id}) filter (where not ${userListItem.watched})::int`,
			durationSec: sql<number>`coalesce(sum(${episode.durationSec}), 0)::real`
		})
		.from(userList)
		.leftJoin(userListItem, eq(userListItem.listId, userList.id))
		.leftJoin(episode, and(eq(episode.id, userListItem.episodeId), playable))
		.where(eq(userList.userId, userId))
		.groupBy(userList.id)
		.orderBy(desc(userList.createdAt));
}

export async function getList(userId: string, listId: number) {
	const [list] = await db
		.select({ id: userList.id, name: userList.name })
		.from(userList)
		.where(and(eq(userList.id, listId), eq(userList.userId, userId)));
	if (!list) return null;

	const items = await db
		.select({
			watched: userListItem.watched,
			id: episode.id,
			title: episodeTitle,
			season: episode.season,
			number: episode.number,
			durationSec: episode.durationSec,
			audioTracks: episode.audioTracks,
			subtitles: episode.subtitles,
			seriesTitle: series.title,
			positionSec: watchProgress.positionSec,
			/** Watched at some point, not necessarily from this list. */
			completedBefore: watchProgress.completed
		})
		.from(userListItem)
		.innerJoin(episode, and(eq(episode.id, userListItem.episodeId), playable))
		.innerJoin(series, eq(series.id, episode.seriesId))
		.leftJoin(
			watchProgress,
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, userId))
		)
		.where(eq(userListItem.listId, listId))
		.orderBy(asc(userListItem.position));

	return { ...list, items };
}

export async function getActiveList(userId: string) {
	const [list] = await db
		.select({ id: userList.id, name: userList.name })
		.from(userSettings)
		.innerJoin(userList, eq(userList.id, userSettings.activeListId))
		.where(eq(userSettings.userId, userId));
	return list ?? null;
}

/** Lists to pick from when adding an episode, newest first like on the lists page. */
export async function getListNames(userId: string) {
	return db
		.select({ id: userList.id, name: userList.name })
		.from(userList)
		.where(eq(userList.userId, userId))
		.orderBy(desc(userList.createdAt));
}

/** Which of the user's lists each episode of the series is already in. */
export async function seriesListItems(userId: string, seriesId: number) {
	return db
		.select({ listId: userListItem.listId, episodeId: userListItem.episodeId })
		.from(userListItem)
		.innerJoin(userList, eq(userList.id, userListItem.listId))
		.innerJoin(episode, eq(episode.id, userListItem.episodeId))
		.where(and(eq(userList.userId, userId), eq(episode.seriesId, seriesId)));
}

async function ownsList(userId: string, listId: number) {
	const [row] = await db
		.select({ id: userList.id })
		.from(userList)
		.where(and(eq(userList.id, listId), eq(userList.userId, userId)));
	return Boolean(row);
}

export async function setActiveList(userId: string, listId: number | null) {
	if (listId !== null && !(await ownsList(userId, listId))) return;
	await db
		.insert(userSettings)
		.values({ userId, activeListId: listId })
		.onConflictDoUpdate({ target: userSettings.userId, set: { activeListId: listId } });
}

/** New lists become the active one: creating a list is usually the first step to filling it. */
export async function createList(userId: string, name: string) {
	const [list] = await db.insert(userList).values({ userId, name }).returning({ id: userList.id });
	await setActiveList(userId, list.id);
	return list.id;
}

export async function renameList(userId: string, listId: number, name: string) {
	await db
		.update(userList)
		.set({ name })
		.where(and(eq(userList.id, listId), eq(userList.userId, userId)));
}

export async function deleteList(userId: string, listId: number) {
	await db.delete(userList).where(and(eq(userList.id, listId), eq(userList.userId, userId)));
}

/** Adds the episode at the end of the list, or removes it if it was already there. */
export async function toggleInList(userId: string, listId: number, episodeId: number) {
	if (!(await ownsList(userId, listId))) return;

	const removed = await db
		.delete(userListItem)
		.where(and(eq(userListItem.listId, listId), eq(userListItem.episodeId, episodeId)))
		.returning({ id: userListItem.episodeId });
	if (removed.length) return;

	await db
		.insert(userListItem)
		.values({
			listId,
			episodeId,
			position: sql`(select coalesce(max(${userListItem.position}) + 1, 0) from ${userListItem} where ${userListItem.listId} = ${listId})`
		})
		.onConflictDoNothing();
}

export async function removeFromList(userId: string, listId: number, episodeId: number) {
	if (!(await ownsList(userId, listId))) return;
	await db
		.delete(userListItem)
		.where(and(eq(userListItem.listId, listId), eq(userListItem.episodeId, episodeId)));
}

/** Swaps the episode with the one before (-1) or after (+1) it. */
export async function moveInList(
	userId: string,
	listId: number,
	episodeId: number,
	direction: -1 | 1
) {
	if (!(await ownsList(userId, listId))) return;
	await db.transaction(async (tx) => {
		const [item] = await tx
			.select({ position: userListItem.position })
			.from(userListItem)
			.where(and(eq(userListItem.listId, listId), eq(userListItem.episodeId, episodeId)));
		if (!item) return;

		// Skips episodes that are not shown (not converted, missing).
		const [neighbour] = await tx
			.select({ episodeId: userListItem.episodeId, position: userListItem.position })
			.from(userListItem)
			.innerJoin(episode, and(eq(episode.id, userListItem.episodeId), playable))
			.where(
				and(
					eq(userListItem.listId, listId),
					direction < 0
						? lt(userListItem.position, item.position)
						: gt(userListItem.position, item.position)
				)
			)
			.orderBy(direction < 0 ? desc(userListItem.position) : asc(userListItem.position))
			.limit(1);
		if (!neighbour) return;

		await tx
			.update(userListItem)
			.set({ position: neighbour.position })
			.where(and(eq(userListItem.listId, listId), eq(userListItem.episodeId, episodeId)));
		await tx
			.update(userListItem)
			.set({ position: item.position })
			.where(and(eq(userListItem.listId, listId), eq(userListItem.episodeId, neighbour.episodeId)));
	});
}

/** Marks every episode as not watched, to play the list again from the start. */
export async function restartList(userId: string, listId: number) {
	if (!(await ownsList(userId, listId))) return;
	await db.update(userListItem).set({ watched: false }).where(eq(userListItem.listId, listId));
}
