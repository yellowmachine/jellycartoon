/**
 * A list's ids with `id` moved just before `before` (null: to the end). What dragging a song in a
 * playlist sends: «before this one» still means the same if the list hides some (a track not
 * ready, one this browser cannot play), where an index would not.
 */
export function moveBefore<T>(ids: readonly T[], id: T, before: T | null): T[] {
	if (!ids.includes(id) || id === before) return [...ids];
	const rest = ids.filter((x) => x !== id);
	const at = before === null ? -1 : rest.indexOf(before);
	if (at < 0) return [...rest, id];
	return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** `itemId` and `beforeId` from a `move` form; null if they are not ids. */
export function moveOf(form: FormData): { itemId: number; beforeId: number | null } | null {
	const itemId = Number(form.get('itemId'));
	const raw = form.get('beforeId');
	const beforeId = raw === null || raw === '' ? null : Number(raw);
	if (!Number.isInteger(itemId) || (beforeId !== null && !Number.isInteger(beforeId))) return null;
	return { itemId, beforeId };
}
