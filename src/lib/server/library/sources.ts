import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode } from '#lib/server/db/schema.ts';
import { hlsDir, sourceFile } from './paths.ts';

export const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);

/** Subtitle files next to the video: `Name.en.vtt`, `Name.es-419.srt`, `Name.srt`… */
export async function sidecarSubtitles(input: string) {
	const dir = path.dirname(input);
	const base = path.basename(input, path.extname(input));
	const entries = await readdir(dir).catch(() => [] as string[]);
	return entries
		.filter(
			(f) => f.startsWith(`${base}.`) && SUBTITLE_EXTENSIONS.has(path.extname(f).toLowerCase())
		)
		.map((f) => ({
			file: path.join(dir, f),
			lang: f.slice(base.length + 1, -path.extname(f).length)
		}));
}

export type RemoveResult = 'removed' | 'changed' | 'no-output' | 'gone';

/**
 * Deletes an episode's original (and its sidecar subtitles) once it has been converted, so the
 * library keeps only the HLS copy. Refuses when the file no longer matches what was converted
 * (e.g. it was still being copied) or when the converted output is missing.
 */
export async function removeSource(ep: {
	id: number;
	sourcePath: string;
	sourceSize: number;
	sourceMtime: Date;
}): Promise<RemoveResult> {
	const input = sourceFile(ep.sourcePath);
	const info = await stat(input).catch(() => null);
	if (!info) return 'gone';
	if (info.size !== ep.sourceSize || info.mtime.getTime() !== ep.sourceMtime.getTime()) {
		return 'changed';
	}
	const master = await stat(path.join(hlsDir(ep.id), 'master.m3u8')).catch(() => null);
	if (!master?.isFile()) return 'no-output';

	const subtitles = await sidecarSubtitles(input);
	await rm(input);
	for (const sub of subtitles) await rm(sub.file, { force: true });
	await db.update(episode).set({ sourceRemoved: true }).where(eq(episode.id, ep.id));
	return 'removed';
}
