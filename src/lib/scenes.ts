/** A film's scenes: the chapters of its file, with the names the AI gives them. */

export interface Chapter {
	startSec: number;
	/** Only a real name: the generic ones («Chapter 01», «00:05:00.000») are left out. */
	title: string | null;
}

export interface SceneName {
	startSec: number;
	name: string;
}

/** «Chapter 01», «Capítulo 3», «00:05:00.000»… as MakeMKV, mkvmerge or the disc name them. */
const GENERIC = /^((chapter|chapitre|cap[ií]tulo|kapitel)[\s_]*)?[\d:.\s]*$/i;

export function chapterTitle(title: string | undefined) {
	const trimmed = title?.trim();
	return trimmed && !GENERIC.test(trimmed) ? trimmed : null;
}

/**
 * The second of each chapter's frame: a little after it starts, past the cut or the fade, but
 * never past the middle of a short one.
 */
export function sceneFrameAt(chapters: Chapter[], index: number, durationSec: number) {
	const start = chapters[index].startSec;
	const end = chapters[index + 1]?.startSec ?? durationSec;
	return Math.floor(Math.min(start + 3, (start + end) / 2));
}

/** The name of each chapter, if the AI gave it one. Chapters are matched by their start. */
export function sceneNames(chapters: Chapter[], names: SceneName[] | null) {
	const byStart = new Map((names ?? []).map((n) => [Math.round(n.startSec), n.name]));
	return chapters.map((c) => c.title ?? byStart.get(Math.round(c.startSec)) ?? null);
}
