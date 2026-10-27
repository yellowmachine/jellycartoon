/**
 * Series in a new order among themselves, inside the whole queue (`all`, in its order): they swap
 * the places they hold and every other series keeps its own. The new `queueOrder` of each series
 * that has one or is moved; the rest stay without (at the end, by id).
 */
export function swapPlaces(all: { id: number; queueOrder: number | null }[], ids: number[]) {
	const moved = new Set(ids);
	const next = ids.filter((id) => all.some((s) => s.id === id));
	const order = all.map((s) => (moved.has(s.id) ? next.shift()! : s.id));
	const kept = new Set([...all.filter((s) => s.queueOrder !== null).map((s) => s.id), ...moved]);
	return order.flatMap((id, i) => (kept.has(id) ? [{ id, queueOrder: i }] : []));
}
