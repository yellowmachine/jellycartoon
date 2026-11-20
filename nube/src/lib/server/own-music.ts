import { lookup } from 'node:dns/promises';
import { randomUUID } from 'node:crypto';
import {
	DeleteObjectCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { listAll, readTags } from './own-music-read.ts';
import { and, asc, eq, inArray, isNotNull, isNull, lt, notExists, or, sql } from 'drizzle-orm';
import { findCover } from './musicbrainz.ts';
import { dev } from '$app/env';
import { asFamily } from './family.ts';
import { openFor, sealFor } from './family-secret.ts';
import { musicSource, ownAlbum, ownTrack } from './db/schema.ts';
import { ownPlace, putFile, removeFile, storageReady } from './storage.ts';
import {
	anyFolderOf,
	bucketProblem,
	endpointProblem,
	labelOf,
	type Bucket
} from './storage-bucket.ts';
import {
	audioType,
	changes,
	folderCovers,
	folderOf,
	folderView,
	mimeOf,
	pictureType,
	trackInfo,
	type Listed
} from './own-music-index.ts';

/**
 * «Tu música» (#534): the music a family keeps in its own bucket (S3, R2, Backblaze…), for Música
 * in Seilide, with or without a house. Seilide reads only what it needs of each file (its tags, by
 * ranges, music-metadata) and keeps an index of it; the audio, never: its address in Seilide
 * answers with a presigned one of the bucket, made each time it is asked for, and the browser
 * plays it from there.
 */

/** A presigned address lasts this long: a long song paused, or skipped into, still plays. */
const SIGNED_SECONDS = 6 * 60 * 60;
/** An indexing that has said nothing for this long is taken as dead (a restart). */
const STALE_MS = 30 * 60_000;
/** The area of the family's storage the covers inside tracks are kept in (storage.ts). */
const COVERS_AREA = 'musica';
/** An album's names as shown: the family's, or its tags'. */
const shownTitle = sql<string>`coalesce(${ownAlbum.customTitle}, ${ownAlbum.title})`;
const shownArtist = sql<string>`coalesce(${ownAlbum.customArtist}, ${ownAlbum.artist})`;

/** What a file without an album tag is in (own-music-index.ts): no album to look up. */
const NO_ALBUM = 'Sin álbum';

/** The family's bucket, opened, a while: every track asked for would otherwise open it again. */
const buckets = new Map<string, { at: number; bucket: Promise<Bucket | null> }>();
const BUCKET_MS = 60_000;

const sourceOf = (familyId: string) =>
	asFamily(familyId, async (tx) => (await tx.select().from(musicSource))[0] ?? null);

export async function bucketOf(familyId: string) {
	const cached = buckets.get(familyId);
	if (cached && Date.now() - cached.at < BUCKET_MS) return cached.bucket;
	const bucket = (async () => {
		const row = await sourceOf(familyId);
		if (!row) return null;
		const text = await openFor(familyId, row.bucket);
		return text ? (JSON.parse(text) as Bucket) : null;
	})();
	bucket.catch(() => buckets.delete(familyId));
	buckets.set(familyId, { at: Date.now(), bucket });
	return bucket;
}

const clientOf = (b: Bucket) => ownPlace(b).client();

/** How it is, for Ajustes and the tab: without the bucket's keys. */
export async function sourceView(familyId: string) {
	const row = await sourceOf(familyId);
	if (!row) return null;
	const scanning = Boolean(
		row.scanningSince && Date.now() - row.scanningSince.getTime() < STALE_MS
	);
	return {
		label: row.label,
		canWrite: row.canWrite,
		scanning,
		phase: scanning ? row.phase : null,
		done: row.done,
		total: row.total,
		coversDone: row.coversDone,
		coversTotal: row.coversTotal,
		indexedAt: row.indexedAt,
		tracks: row.tracks,
		problem: row.problem
	};
}

export type SourceView = NonNullable<Awaited<ReturnType<typeof sourceView>>>;

/**
 * Whether Seilide can read music in that bucket: its address may be reached, its folder listed and
 * a file in it read. And whether its keys can also write, said as a warning: read-only are enough.
 * What is wrong, or how it is.
 */
export async function testSource(b: Bucket): Promise<{ problem: string } | { canWrite: boolean }> {
	const wrong = await endpointProblem(
		b.endpoint,
		(host) => lookup(host, { all: true, verbatim: true }),
		{
			allowPrivate: dev
		}
	);
	if (wrong) return { problem: wrong };
	const s3 = await clientOf(b);
	try {
		const page = await s3.send(
			new ListObjectsV2Command({ Bucket: b.bucket, Prefix: b.prefix, MaxKeys: 1000 })
		);
		// A file with something in it: a folder made in the provider's panel is an empty object
		// (`Juegos/`), and a range of nothing is refused (R2: «invalid range»).
		const files = (page.Contents ?? []).filter(
			(o) => o.Key && !o.Key.endsWith('/') && (o.Size ?? 0) > 0
		);
		const first = files.find((o) => audioType(o.Key!)) ?? files[0];
		if (first?.Key)
			await s3.send(
				new GetObjectCommand({ Bucket: b.bucket, Key: first.Key, Range: 'bytes=0-15' })
			);
	} catch (err) {
		return { problem: readProblem(err) };
	}
	// Writing: a file of nothing, deleted at once. Refused, as it should.
	const probe = `${b.prefix}.seilide-prueba-${randomUUID()}`;
	try {
		await s3.send(new PutObjectCommand({ Bucket: b.bucket, Key: probe, Body: '' }));
	} catch {
		return { canWrite: false };
	}
	await s3.send(new DeleteObjectCommand({ Bucket: b.bucket, Key: probe })).catch(() => {});
	return { canWrite: true };
}

/** An S3 error when reading, as the family reads it (bucketProblem speaks of writing too). */
function readProblem(err: unknown) {
	const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
	if (e?.name === 'AccessDenied' || e?.$metadata?.httpStatusCode === 403)
		return 'Las claves no valen o no tienen permiso para listar y leer en ese bucket';
	return bucketProblem(err);
}

/** Saved after trying it, and the index begins. What is wrong, or null. */
export async function saveSource(familyId: string, b: Bucket) {
	const tried = await testSource(b);
	if ('problem' in tried) return tried.problem;
	const sealed = await sealFor(familyId, JSON.stringify(b));
	const old = await bucketOf(familyId);
	const samePlace =
		old && old.endpoint === b.endpoint && old.bucket === b.bucket && old.prefix === b.prefix;
	// Another place: what was read of the last one goes.
	if (old && !samePlace) await forgetIndex(familyId);
	const set = { bucket: sealed, label: labelOf(b), canWrite: tried.canWrite, problem: null };
	await asFamily(familyId, (tx) =>
		tx
			.insert(musicSource)
			.values({ familyId, ...set })
			.onConflictDoUpdate({ target: musicSource.familyId, set })
	);
	buckets.delete(familyId);
	void indexMusic(familyId);
	return null;
}

/** «Quitar»: its index and its keys go; the bucket, as it is. */
export async function removeSource(familyId: string) {
	await forgetIndex(familyId);
	await asFamily(familyId, (tx) => tx.delete(musicSource));
	buckets.delete(familyId);
}

async function forgetIndex(familyId: string) {
	const files = await asFamily(familyId, async (tx) => {
		const rows = await tx.select({ file: ownAlbum.coverFile }).from(ownAlbum);
		await tx.delete(ownTrack);
		await tx.delete(ownAlbum);
		return rows.map((r) => r.file).filter((f): f is string => Boolean(f));
	});
	for (const file of files) await removeFile(familyId, COVERS_AREA, file).catch(() => {});
}

/** The indexings running in this server: never two for a family. */
const running = new Set<string>();

/**
 * The bucket read again: the new and changed files' tags, the gone ones out. One at a time per
 * family; another asked for meanwhile, nothing (Ajustes shows the one going).
 */
export async function indexMusic(familyId: string) {
	if (running.has(familyId)) return;
	running.add(familyId);
	try {
		// Taken in the database too: another server (or this one before a restart) may be on it.
		const now = new Date();
		const taken = await asFamily(familyId, (tx) =>
			tx
				.update(musicSource)
				.set({
					scanningSince: now,
					phase: 'leyendo',
					done: 0,
					total: 0,
					coversDone: 0,
					coversTotal: 0,
					problem: null
				})
				.where(
					or(
						isNull(musicSource.scanningSince),
						lt(musicSource.scanningSince, new Date(now.getTime() - STALE_MS))
					)
				)
				.returning({ familyId: musicSource.familyId })
		);
		if (!taken.length) return;
		await scan(familyId).catch(async (err) => {
			const problem =
				err instanceof Error && err.name === 'Seilide' ? err.message : readProblem(err);
			console.warn('[tu música] No se pudo leer el bucket', { familyId, problem });
			await asFamily(familyId, (tx) =>
				tx.update(musicSource).set({ scanningSince: null, phase: null, problem })
			);
		});
	} finally {
		running.delete(familyId);
	}
}

async function scan(familyId: string) {
	const b = await bucketOf(familyId);
	if (!b) {
		const err = new Error('No se pueden abrir las claves del bucket: vuelve a escribirlas');
		err.name = 'Seilide';
		throw err;
	}
	const s3 = await clientOf(b);
	const listed = await listAll(s3, b);
	const audios = listed.filter((l) => audioType(l.key));
	const covers = folderCovers(listed.map((l) => l.key));
	const indexed = await asFamily(familyId, (tx) =>
		tx
			.select({ id: ownTrack.id, key: ownTrack.key, etag: ownTrack.etag, size: ownTrack.size })
			.from(ownTrack)
	);
	const { read, gone } = changes(audios, indexed);
	const progress = (done: number) =>
		asFamily(familyId, (tx) =>
			tx.update(musicSource).set({ done, total: read.length, scanningSince: new Date() })
		);
	await progress(0);
	if (gone.length)
		await asFamily(familyId, (tx) => tx.delete(ownTrack).where(inArray(ownTrack.id, gone)));
	let done = 0;
	const failures: { key: string; error: string }[] = [];
	for (const file of read) {
		try {
			await indexFile(familyId, s3, b, file, covers.get(folderOf(file.key)) ?? null);
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			if (failures.length < 100) failures.push({ key: file.key, error });
			console.warn('[tu música] No se pudo leer un fichero', { familyId, key: file.key, error });
		}
		done++;
		if (done % 10 === 0) await progress(done);
	}
	await dropEmptyAlbums(familyId);
	await refreshCovers(familyId, covers);
	const [{ count }] = await asFamily(familyId, (tx) =>
		tx.select({ count: sql<number>`count(*)::int` }).from(ownTrack)
	).then((rows) => rows as [{ count: number }]);
	const failed = failures.length;
	await asFamily(familyId, (tx) =>
		tx.update(musicSource).set({
			done,
			total: read.length,
			indexedAt: new Date(),
			tracks: count,
			failures,
			problem: failed
				? `${failed} ${failed === 1 ? 'fichero no se pudo' : 'ficheros no se pudieron'} leer`
				: null
		})
	);
	console.log('[tu música] Bucket leído', {
		familyId,
		read: read.length,
		gone: gone.length,
		failed,
		tracks: count
	});
	await findCovers(familyId);
	await asFamily(familyId, (tx) =>
		tx.update(musicSource).set({ scanningSince: null, phase: null })
	);
}

/** Seilide's file storage missing: the covers from MusicBrainz cannot be kept, not looked up. */
const MAX_NETWORK_FAILURES = 3;

/**
 * The albums still without a cover (no picture in their folder nor in their tracks), looked up in
 * MusicBrainz and kept in the family's storage. One not found is not looked up again (`no`) but by
 * «Buscar portadas otra vez»; a network failure leaves it for the next time, and a few in a row
 * stop the search.
 */
async function findCovers(familyId: string) {
	if (!storageReady) return;
	const pending = await asFamily(familyId, (tx) =>
		tx
			.select({ id: ownAlbum.id, title: shownTitle, artist: shownArtist })
			.from(ownAlbum)
			.where(
				and(
					eq(ownAlbum.coverStatus, 'pendiente'),
					isNull(ownAlbum.coverKey),
					isNull(ownAlbum.coverFile)
				)
			)
			.orderBy(asc(shownArtist), asc(shownTitle))
	);
	const progress = (coversDone: number) =>
		asFamily(familyId, (tx) =>
			tx.update(musicSource).set({
				phase: 'portadas',
				coversDone,
				coversTotal: pending.length,
				scanningSince: new Date()
			})
		);
	await progress(0);
	let done = 0;
	let failing = 0;
	for (const a of pending) {
		try {
			const bytes = a.title === NO_ALBUM ? null : await findCover(a.title, a.artist);
			failing = 0;
			if (bytes) {
				// A new name each time: its address changes (coverVersion), and the browser's copy goes.
				const name = `portada-${a.id}-${Date.now()}.jpg`;
				await putFile(familyId, COVERS_AREA, name, bytes, 'image/jpeg');
				await asFamily(familyId, (tx) =>
					tx
						.update(ownAlbum)
						.set({
							coverFile: name,
							coverType: 'image/jpeg',
							coverStatus: 'encontrada',
							coverSource: 'musicbrainz'
						})
						.where(eq(ownAlbum.id, a.id))
				);
			} else
				await asFamily(familyId, (tx) =>
					tx.update(ownAlbum).set({ coverStatus: 'no' }).where(eq(ownAlbum.id, a.id))
				);
		} catch (err) {
			console.warn('[tu música] No se pudo buscar una portada', {
				familyId,
				album: `${a.artist} - ${a.title}`,
				error: err instanceof Error ? err.message : String(err)
			});
			if (++failing >= MAX_NETWORK_FAILURES) break;
		}
		await progress(++done);
	}
}

/**
 * An album's title and artist as the family wants them (#534); the same as its tags', back to
 * them. Its cover from MusicBrainz, or none found, is looked up again with the new names; one in
 * its folder or its tracks stays. False, not the family's.
 */
export async function renameAlbum(
	familyId: string,
	id: number,
	names: { title: string; artist: string }
) {
	const changed = await asFamily(familyId, async (tx) => {
		const [album] = await tx.select().from(ownAlbum).where(eq(ownAlbum.id, id));
		if (!album) return null;
		const customTitle = names.title === album.title ? null : names.title;
		const customArtist = names.artist === album.artist ? null : names.artist;
		const fromMusicBrainz = album.coverSource === 'musicbrainz';
		const lookAgain = fromMusicBrainz || album.coverStatus === 'no';
		await tx
			.update(ownAlbum)
			.set({
				customTitle,
				customArtist,
				...(lookAgain
					? {
							coverStatus: 'pendiente' as const,
							coverSource: null,
							...(fromMusicBrainz ? { coverFile: null, coverType: null } : {})
						}
					: {})
			})
			.where(eq(ownAlbum.id, id));
		return { lookAgain, oldFile: fromMusicBrainz ? album.coverFile : null };
	});
	if (!changed) return false;
	if (changed.oldFile) await removeFile(familyId, COVERS_AREA, changed.oldFile).catch(() => {});
	if (changed.lookAgain) void indexMusic(familyId);
	return true;
}

/** «Buscar portadas otra vez»: the albums not found before, looked up again with the next reading. */
export async function retryCovers(familyId: string) {
	await asFamily(familyId, (tx) =>
		tx.update(ownAlbum).set({ coverStatus: 'pendiente' }).where(eq(ownAlbum.coverStatus, 'no'))
	);
	void indexMusic(familyId);
}

/** Gestión (#534): how the reading went, what could not be read, and the albums without a cover. */
export async function management(familyId: string) {
	const source = await sourceView(familyId);
	if (!source) return null;
	return asFamily(familyId, async (tx) => {
		const [row] = await tx.select({ failures: musicSource.failures }).from(musicSource);
		const albums = await tx
			.select({
				id: ownAlbum.id,
				title: shownTitle,
				artist: shownArtist,
				status: ownAlbum.coverStatus,
				source: ownAlbum.coverSource
			})
			.from(ownAlbum)
			.orderBy(asc(shownArtist), asc(shownTitle));
		const count = (source: string) => albums.filter((a) => a.source === source).length;
		return {
			source,
			failures: row?.failures ?? [],
			albums: albums.length,
			covers: {
				carpeta: count('carpeta'),
				cancion: count('cancion'),
				musicbrainz: count('musicbrainz')
			},
			withoutCover: albums
				.filter((a) => a.status !== 'encontrada')
				.map(({ id, title, artist, status }) => ({
					id,
					title,
					artist,
					pending: status === 'pendiente'
				})),
			storage: storageReady
		};
	});
}

async function indexFile(
	familyId: string,
	s3: S3Client,
	b: Bucket,
	file: Listed,
	folderCover: string | null
) {
	const meta = await readTags(s3, b, file.key);
	const info = trackInfo(file.key, b.prefix, meta.common);
	const picture = meta.common.picture?.[0];
	const albumId = await asFamily(familyId, async (tx) => {
		const [album] = await tx
			.insert(ownAlbum)
			.values({
				familyId,
				title: info.album,
				artist: info.albumArtist,
				year: info.year,
				coverKey: folderCover
			})
			.onConflictDoUpdate({
				target: [ownAlbum.familyId, ownAlbum.title, ownAlbum.artist],
				set: {
					year: sql`coalesce(${ownAlbum.year}, excluded.year)`,
					coverKey: sql`coalesce(excluded.cover_key, ${ownAlbum.coverKey})`
				}
			})
			.returning({ id: ownAlbum.id, coverKey: ownAlbum.coverKey, coverFile: ownAlbum.coverFile });
		const row = {
			familyId,
			albumId: album!.id,
			key: file.key,
			etag: file.etag,
			size: file.size,
			title: info.title,
			artist: info.artist,
			disc: info.disc,
			number: info.number,
			durationSec: meta.format.duration ? Math.round(meta.format.duration) : null,
			mime: mimeOf(file.key, meta.format.codec)
		};
		await tx
			.insert(ownTrack)
			.values(row)
			.onConflictDoUpdate({ target: [ownTrack.familyId, ownTrack.key], set: row });
		return { ...album!, needsPicture: !album!.coverKey && !album!.coverFile };
	});
	// No picture in its folder: the one inside the track, kept in the family's storage.
	if (albumId.needsPicture && picture && storageReady && picture.data.length < 4 * 1024 * 1024) {
		const type = picture.format.startsWith('image/') ? picture.format : 'image/jpeg';
		const name = `portada-${albumId.id}.${type === 'image/png' ? 'png' : 'jpg'}`;
		await putFile(familyId, COVERS_AREA, name, picture.data, type);
		await asFamily(familyId, (tx) =>
			tx
				.update(ownAlbum)
				.set({
					coverFile: name,
					coverType: type,
					coverStatus: 'encontrada',
					coverSource: 'cancion'
				})
				.where(eq(ownAlbum.id, albumId.id))
		);
	}
}

/**
 * Each album's picture in its folder, as the bucket is now: one added later (its tracks unchanged,
 * not read again) is taken; one gone, forgotten.
 */
async function refreshCovers(familyId: string, covers: Map<string, string>) {
	await asFamily(familyId, async (tx) => {
		const rows = await tx
			.select({
				id: ownAlbum.id,
				coverKey: ownAlbum.coverKey,
				key: sql<string>`min(${ownTrack.key})`
			})
			.from(ownAlbum)
			.innerJoin(ownTrack, eq(ownTrack.albumId, ownAlbum.id))
			.groupBy(ownAlbum.id, ownAlbum.coverKey);
		for (const r of rows) {
			const now = covers.get(folderOf(r.key)) ?? null;
			if (now !== r.coverKey)
				await tx.update(ownAlbum).set({ coverKey: now }).where(eq(ownAlbum.id, r.id));
		}
		// Where each one's cover is now: its folder's first; without it, what was kept (from a
		// track or MusicBrainz); nothing, to look up again.
		await tx
			.update(ownAlbum)
			.set({ coverStatus: 'encontrada', coverSource: 'carpeta' })
			.where(isNotNull(ownAlbum.coverKey));
		await tx
			.update(ownAlbum)
			.set({ coverStatus: 'pendiente', coverSource: null })
			.where(
				and(
					isNull(ownAlbum.coverKey),
					isNull(ownAlbum.coverFile),
					eq(ownAlbum.coverStatus, 'encontrada')
				)
			);
		await tx
			.update(ownAlbum)
			.set({ coverSource: null })
			.where(and(isNull(ownAlbum.coverKey), eq(ownAlbum.coverSource, 'carpeta')));
	});
}

/** Albums left without tracks (all gone, or renamed in their tags): out, with their covers. */
async function dropEmptyAlbums(familyId: string) {
	const files = await asFamily(familyId, async (tx) => {
		const empty = await tx
			.delete(ownAlbum)
			.where(
				notExists(
					tx
						.select({ one: sql`1` })
						.from(ownTrack)
						.where(eq(ownTrack.albumId, ownAlbum.id))
				)
			)
			.returning({ file: ownAlbum.coverFile });
		return empty.map((r) => r.file).filter((f): f is string => Boolean(f));
	});
	for (const file of files) await removeFile(familyId, COVERS_AREA, file).catch(() => {});
}

/** Once a day, every family with a bucket (the scheduler): one after another. */
export async function indexAll(familyIds: string[]) {
	for (const familyId of familyIds)
		if (await sourceOf(familyId).catch(() => null)) await indexMusic(familyId);
}

export interface OwnTrackRow {
	id: number;
	albumId: number;
	title: string;
	artist: string;
	disc: number | null;
	number: number | null;
	durationSec: number | null;
	mime: string;
}

export interface OwnAlbumRow {
	id: number;
	title: string;
	artist: string;
	tags: { title: string; artist: string } | null;
	year: number | null;
	hasCover: boolean;
	/** Changes with its cover: in its address, so the browser does not keep showing the old one. */
	coverVersion: string | null;
	tracks: OwnTrackRow[];
}

/** Every album with its tracks in order: the tab searches and groups them in the browser. */
export async function ownCatalog(familyId: string): Promise<OwnAlbumRow[]> {
	return asFamily(familyId, async (tx) => {
		const albums = await tx.select().from(ownAlbum);
		const tracks = await tx
			.select({
				id: ownTrack.id,
				albumId: ownTrack.albumId,
				title: ownTrack.title,
				artist: ownTrack.artist,
				disc: ownTrack.disc,
				number: ownTrack.number,
				durationSec: ownTrack.durationSec,
				mime: ownTrack.mime,
				key: ownTrack.key
			})
			.from(ownTrack)
			.orderBy(asc(ownTrack.disc), asc(ownTrack.number), asc(ownTrack.key));
		const byAlbum = new Map<number, OwnTrackRow[]>();
		for (const { key: _key, ...t } of tracks)
			byAlbum.set(t.albumId, [...(byAlbum.get(t.albumId) ?? []), t]);
		return albums
			.map((a) => ({
				id: a.id,
				title: a.customTitle ?? a.title,
				artist: a.customArtist ?? a.artist,
				/** What its tags say, when the family wrote another name. */
				tags:
					a.customTitle !== null || a.customArtist !== null
						? { title: a.title, artist: a.artist }
						: null,
				year: a.year,
				hasCover: Boolean(a.coverKey || a.coverFile),
				coverVersion: a.coverKey ?? a.coverFile,
				tracks: byAlbum.get(a.id) ?? []
			}))
			.filter((a) => a.tracks.length)
			.sort(
				(a, b) =>
					a.artist.localeCompare(b.artist, 'es', { sensitivity: 'base' }) ||
					a.title.localeCompare(b.title, 'es', { sensitivity: 'base' })
			);
	});
}

/** A track as Carpetas shows it: with its album's, for the player (own-music.ts `asTrack`). */
export interface OwnFolderTrack extends OwnTrackRow {
	album: Pick<OwnAlbumRow, 'id' | 'title' | 'hasCover' | 'coverVersion'>;
}

/**
 * A folder of the bucket (#534, phase 3), as the house's Carpetas: its folders and its own tracks,
 * from what was read of it (not listed again). `path` relative to the music's folder; null, none
 * such, or no bucket.
 */
export async function ownFolder(familyId: string, path: string) {
	const clean = anyFolderOf(path);
	const b = clean === null ? null : await bucketOf(familyId);
	if (clean === null || !b) return null;
	const rows = await asFamily(familyId, (tx) =>
		tx
			.select({
				id: ownTrack.id,
				albumId: ownTrack.albumId,
				title: ownTrack.title,
				artist: ownTrack.artist,
				disc: ownTrack.disc,
				number: ownTrack.number,
				durationSec: ownTrack.durationSec,
				mime: ownTrack.mime,
				key: ownTrack.key,
				albumTitle: ownAlbum.title,
				customTitle: ownAlbum.customTitle,
				coverKey: ownAlbum.coverKey,
				coverFile: ownAlbum.coverFile
			})
			.from(ownTrack)
			.innerJoin(ownAlbum, eq(ownAlbum.id, ownTrack.albumId))
	);
	const view = folderView(rows, b.prefix, clean.replace(/\/$/, ''));
	if (!view) return null;
	return {
		...view,
		tracks: view.tracks.map(
			({ key: _key, albumTitle, customTitle, coverKey, coverFile, ...t }): OwnFolderTrack => ({
				...t,
				album: {
					id: t.albumId,
					title: customTitle ?? albumTitle,
					hasCover: Boolean(coverKey || coverFile),
					coverVersion: coverKey ?? coverFile
				}
			})
		)
	};
}

/**
 * A client only to sign addresses, one per bucket and keys: without the checksum the SDK now asks
 * for by default (`x-amz-checksum-mode` in the address), which not every S3 takes.
 */
const signers = new Map<string, S3Client>();
function signerOf(b: Bucket) {
	const id = JSON.stringify(b);
	let s3 = signers.get(id);
	if (!s3) {
		s3 = new S3Client({
			endpoint: b.endpoint,
			region: b.region,
			forcePathStyle: !new URL(b.endpoint).hostname.endsWith('amazonaws.com'),
			credentials: { accessKeyId: b.accessKeyId, secretAccessKey: b.secretAccessKey },
			requestChecksumCalculation: 'WHEN_REQUIRED',
			responseChecksumValidation: 'WHEN_REQUIRED'
		});
		signers.set(id, s3);
	}
	return s3;
}

/** A presigned address of the bucket for a key; with its type, for a bucket that says another. */
async function signed(b: Bucket, key: string, type?: string) {
	return getSignedUrl(
		signerOf(b),
		new GetObjectCommand({
			Bucket: b.bucket,
			Key: key,
			...(type ? { ResponseContentType: type } : {})
		}),
		{ expiresIn: SIGNED_SECONDS }
	);
}

/** Where a track of the family plays from now; null, not its own (another family's, gone). */
export async function trackAddress(familyId: string, id: number) {
	const [track] = await asFamily(familyId, (tx) =>
		tx.select({ key: ownTrack.key, mime: ownTrack.mime }).from(ownTrack).where(eq(ownTrack.id, id))
	);
	const b = track ? await bucketOf(familyId) : null;
	if (!track || !b) return null;
	return signed(b, track.key, track.mime.split(';')[0]);
}

/**
 * An album's cover: a presigned address if it is a picture in the bucket, or the one kept from
 * inside a track (`file`, served by Seilide from the family's storage). Null, none.
 */
export type Cover = { url: string } | { url?: undefined; file: string; area: string; type: string };

export async function coverOf(familyId: string, albumId: number): Promise<Cover | null> {
	const [album] = await asFamily(familyId, (tx) =>
		tx
			.select({ key: ownAlbum.coverKey, file: ownAlbum.coverFile, type: ownAlbum.coverType })
			.from(ownAlbum)
			.where(eq(ownAlbum.id, albumId))
	);
	if (!album) return null;
	if (album.key) {
		const b = await bucketOf(familyId);
		return b ? { url: await signed(b, album.key, pictureType(album.key) ?? undefined) } : null;
	}
	if (album.file) return { file: album.file, area: COVERS_AREA, type: album.type ?? 'image/jpeg' };
	return null;
}
