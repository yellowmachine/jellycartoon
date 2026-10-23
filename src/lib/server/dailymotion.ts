import { and, desc, eq, sql } from 'drizzle-orm';
import { DAILYMOTION_PLAYER_ID } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { dailymotionProgress, dailymotionSource, dailymotionVideo } from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';

/**
 * Dailymotion's cartoons for the children (#66): the videos of the accounts and playlists the adults
 * chose, from Dailymotion's public data API (https://developers.dailymotion.com, no key to read
 * what is public), always with the family filter; played with Dailymotion's own player, made in
 * Dailymotion Studio (DAILYMOTION_PLAYER_ID). Nothing else is shown or played: not what its search
 * finds, not what its player recommends.
 */

export const dailymotionPlayerId = DAILYMOTION_PLAYER_ID ?? null;
export const dailymotionEnabled = Boolean(DAILYMOTION_PLAYER_ID);

const API = 'https://api.dailymotion.com';
/** What the API says is kept this long: lists change little, and it has no stated rate limit. */
const CACHE_MS = 30 * 60_000;
/** A page of a source's videos. */
export const PAGE = 48;
/** At most these pages of a playlist are read to know whether a video is in it. */
const PLAYLIST_PAGES = 10;

/** Dailymotion's ids (`xbtt1c`, `x8abc12`) and accounts' names: nothing else goes in a URL. */
const isXid = (id: string) => /^[a-zA-Z0-9]{3,20}$/.test(id);
const isUsername = (name: string) => /^[\w.-]{1,64}$/.test(name);

const cache = new Map<string, { at: number; value: unknown }>();

async function api<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
	const url = new URL(API + path);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
	const key = url.href;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
	const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch((err) => {
		throw new Error(
			`No se pudo hablar con Dailymotion: ${err instanceof Error ? err.message : err}`
		);
	});
	const body = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`Dailymotion: ${body?.error?.message ?? res.statusText}`);
	cache.set(key, { at: Date.now(), value: body });
	return body as T;
}

interface ApiVideo {
	id: string;
	title: string;
	duration: number;
	thumbnail_360_url?: string;
	'owner.id'?: string;
	'owner.screenname'?: string;
	explicit?: boolean;
	private?: boolean;
}

const VIDEO_FIELDS =
	'id,title,duration,thumbnail_360_url,owner.id,owner.screenname,explicit,private';

export interface DmVideo {
	id: string;
	title: string;
	owner: string;
	durationSec: number;
	thumbnail: string | null;
}

const toVideo = (v: ApiVideo): DmVideo => ({
	id: v.id,
	title: v.title,
	owner: v['owner.screenname'] ?? '',
	durationSec: v.duration,
	thumbnail: v.thumbnail_360_url ?? null
});

/** Only what the family filter lets through, and nothing private. */
const suitable = (v: ApiVideo) => !v.explicit && !v.private;

// Sources.

export type SourceKind = 'user' | 'playlist';

export interface Candidate {
	kind: SourceKind;
	xid: string;
	name: string;
	image: string | null;
	/** «62 vídeos · Pocoyo». */
	detail: string;
}

/**
 * What a typed text finds to add: a link to an account or a playlist (`dailymotion.com/pocoyo`,
 * `dailymotion.com/playlist/x79dlo`), or the accounts whose name has it.
 */
export async function findSources(text: string): Promise<Candidate[]> {
	const query = text.trim();
	if (!query) return [];
	const link = query.match(/dailymotion\.com\/(?:playlist\/([a-zA-Z0-9]+)|([\w.-]+))/);
	if (link?.[1] && isXid(link[1])) {
		const p = await playlistInfo(link[1]);
		return p ? [p] : [];
	}
	if (link?.[2] && isUsername(link[2]) && !['video', 'embed'].includes(link[2])) {
		const u = await userInfo(link[2]);
		return u ? [u] : [];
	}
	// Accounts only: searching playlists needs Dailymotion's sign-in; they are added by their link.
	const users = await api<{ list: UserRow[] }>('/users', {
		search: query,
		fields: USER_FIELDS,
		limit: 10
	});
	return users.list.filter((u) => u.videos_total > 0).map(userCandidate);
}

interface UserRow {
	id: string;
	screenname: string;
	avatar_120_url?: string;
	videos_total: number;
}
const USER_FIELDS = 'id,screenname,avatar_120_url,videos_total';
const userCandidate = (u: UserRow): Candidate => ({
	kind: 'user',
	xid: u.id,
	name: u.screenname,
	image: u.avatar_120_url ?? null,
	detail: `Cuenta · ${u.videos_total} vídeos`
});

interface PlaylistRow {
	id: string;
	name: string;
	thumbnail_240_url?: string;
	videos_total: number;
	'owner.screenname'?: string;
}
const PLAYLIST_FIELDS = 'id,name,thumbnail_240_url,videos_total,owner.screenname';
const playlistCandidate = (p: PlaylistRow): Candidate => ({
	kind: 'playlist',
	xid: p.id,
	name: p.name,
	image: p.thumbnail_240_url ?? null,
	detail: `Lista de ${p['owner.screenname'] ?? '?'} · ${p.videos_total} vídeos`
});

async function userInfo(idOrName: string) {
	const u = await api<UserRow>(`/user/${encodeURIComponent(idOrName)}`, {
		fields: USER_FIELDS
	}).catch(() => null);
	return u?.id ? userCandidate(u) : null;
}

async function playlistInfo(xid: string) {
	const p = await api<PlaylistRow>(`/playlist/${xid}`, { fields: PLAYLIST_FIELDS }).catch(
		() => null
	);
	return p?.id ? playlistCandidate(p) : null;
}

/** An account or playlist, for the children: read again from Dailymotion, not from the page. */
export async function addSource(kind: SourceKind, xid: string, adultId: string) {
	if (!isXid(xid)) throw new Error('No es un id de Dailymotion');
	const info = kind === 'user' ? await userInfo(xid) : await playlistInfo(xid);
	if (!info) throw new Error('Dailymotion no la encuentra');
	await db
		.insert(dailymotionSource)
		.values({ kind, xid: info.xid, name: info.name, image: info.image, addedBy: adultId })
		.onConflictDoNothing();
	log.info('dailymotion', `Para los peques: ${info.name}`, { kind, xid, by: adultId });
}

export async function removeSource(id: number) {
	await db.delete(dailymotionSource).where(eq(dailymotionSource.id, id));
	log.info('dailymotion', 'Fuente quitada', { sourceId: id });
}

export async function sources() {
	return db.select().from(dailymotionSource).orderBy(dailymotionSource.name);
}

export async function source(id: number) {
	const [row] = await db.select().from(dailymotionSource).where(eq(dailymotionSource.id, id));
	return row ?? null;
}

// Videos.

/** A page of a source's videos, the newest first (an account) or in its order (a playlist). */
export async function sourceVideos(src: { kind: SourceKind; xid: string }, page = 1) {
	const path = src.kind === 'user' ? `/user/${src.xid}/videos` : `/playlist/${src.xid}/videos`;
	const body = await api<{ list: ApiVideo[]; has_more: boolean; total?: number }>(path, {
		fields: VIDEO_FIELDS,
		family_filter: 1,
		limit: PAGE,
		page,
		...(src.kind === 'user' ? { sort: 'recent' } : {})
	});
	return { videos: body.list.filter(suitable).map(toVideo), more: body.has_more };
}

/** Every video id of a playlist, as far as PLAYLIST_PAGES pages go. */
async function playlistIds(xid: string) {
	const ids = new Set<string>();
	for (let page = 1; page <= PLAYLIST_PAGES; page++) {
		const body = await api<{ list: { id: string }[]; has_more: boolean }>(
			`/playlist/${xid}/videos`,
			{ fields: 'id', limit: 100, page }
		);
		for (const v of body.list) ids.add(v.id);
		if (!body.has_more) break;
	}
	return ids;
}

/**
 * The video, if the children may watch it: suitable, and from an account or a playlist the
 * adults chose. Kept in `dailymotion_video`, for the history and «Ahora».
 */
export async function allowedVideo(xid: string): Promise<DmVideo | null> {
	if (!isXid(xid)) return null;
	const v = await api<ApiVideo>(`/video/${xid}`, { fields: VIDEO_FIELDS }).catch(() => null);
	if (!v?.id || !suitable(v)) return null;
	const chosen = await sources();
	let ok = chosen.some((s) => s.kind === 'user' && s.xid === v['owner.id']);
	for (const s of chosen.filter((s) => s.kind === 'playlist')) {
		if (ok) break;
		ok = (await playlistIds(s.xid).catch(() => new Set<string>())).has(v.id);
	}
	if (!ok) return null;
	const video = toVideo(v);
	const row = {
		title: video.title,
		owner: video.owner,
		durationSec: video.durationSec,
		thumbnail: video.thumbnail,
		updatedAt: new Date()
	};
	await db
		.insert(dailymotionVideo)
		.values({ xid: video.id, ...row })
		.onConflictDoUpdate({ target: dailymotionVideo.xid, set: row });
	return video;
}

/** Whether this video is one played here (so its progress and time can be kept). */
export async function knownVideo(xid: string) {
	if (!isXid(xid)) return false;
	const [row] = await db
		.select({ xid: dailymotionVideo.xid })
		.from(dailymotionVideo)
		.where(eq(dailymotionVideo.xid, xid));
	return Boolean(row);
}

// Progress.

export async function saveProgress(
	userId: string,
	xid: string,
	positionSec: number,
	completed: boolean
) {
	const row = { positionSec: completed ? 0 : positionSec, completed, updatedAt: new Date() };
	await db
		.insert(dailymotionProgress)
		.values({ userId, videoXid: xid, ...row })
		.onConflictDoUpdate({
			target: [dailymotionProgress.userId, dailymotionProgress.videoXid],
			// Once watched, it stays watched.
			set: { ...row, completed: sql`${dailymotionProgress.completed} or ${completed}` }
		});
}

export async function progressOf(userId: string, xid: string) {
	const [row] = await db
		.select({ positionSec: dailymotionProgress.positionSec })
		.from(dailymotionProgress)
		.where(and(eq(dailymotionProgress.userId, userId), eq(dailymotionProgress.videoXid, xid)));
	return row?.positionSec ?? 0;
}

/** Each user's watched and half-watched videos, for the marks on the lists. */
export async function progressMap(userId: string) {
	const rows = await db
		.select({
			xid: dailymotionProgress.videoXid,
			positionSec: dailymotionProgress.positionSec,
			completed: dailymotionProgress.completed
		})
		.from(dailymotionProgress)
		.where(eq(dailymotionProgress.userId, userId));
	return new Map(rows.map((r) => [r.xid, r]));
}

/** «Seguir viendo»: started and not finished, the latest first. */
export async function continueWatching(userId: string, limit = 8) {
	return db
		.select({
			id: dailymotionVideo.xid,
			title: dailymotionVideo.title,
			owner: dailymotionVideo.owner,
			durationSec: dailymotionVideo.durationSec,
			thumbnail: dailymotionVideo.thumbnail,
			positionSec: dailymotionProgress.positionSec
		})
		.from(dailymotionProgress)
		.innerJoin(dailymotionVideo, eq(dailymotionVideo.xid, dailymotionProgress.videoXid))
		.where(
			and(
				eq(dailymotionProgress.userId, userId),
				eq(dailymotionProgress.completed, false),
				sql`${dailymotionProgress.positionSec} > 5`
			)
		)
		.orderBy(desc(dailymotionProgress.updatedAt))
		.limit(limit);
}
