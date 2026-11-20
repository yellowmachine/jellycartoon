import Sortable from 'sortablejs';
import type { Attachment } from 'svelte/attachments';
import { deserialize } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import { moveBefore } from './reorder.ts';

/**
 * A playlist's songs dragged into place by their handle (`.drag-handle`), with the mouse or a
 * finger: SortableJS, which on touch screens keeps scrolling the page and scrolls by itself near
 * the edges. Each row is an element with `data-id`, its item id. On dropping, the DOM goes back as
 * Svelte left it and `onmove` says where it went: `beforeId`, the row it ended above, or null at
 * the end; the page then shows it in its new place.
 */
export function sortable(onmove: (itemId: number, beforeId: number | null) => void): Attachment {
	return (list) => {
		let next: Node | null = null;
		const s = Sortable.create(list as HTMLElement, {
			handle: '.drag-handle',
			draggable: '[data-id]',
			animation: 150,
			// Its own dragging, not the browser's: the same with the mouse as with a finger.
			forceFallback: true,
			ghostClass: 'opacity-40',
			chosenClass: 'bg-zinc-800',
			onStart: (e) => {
				next = e.item.nextSibling;
			},
			onEnd: (e) => {
				if (e.oldIndex === e.newIndex) return;
				const after = e.item.nextElementSibling as HTMLElement | null;
				const beforeId = after?.dataset.id ? Number(after.dataset.id) : null;
				// Svelte's keyed each owns these nodes: back where it put them, then its state moves them.
				list.insertBefore(e.item, next);
				onmove(Number((e.item as HTMLElement).dataset.id), beforeId);
			}
		});
		return () => s.destroy();
	};
}

/**
 * The rows of a playlist page in the order the person left them, sent to the page's `move` action
 * (`itemId`, `beforeId`) and shown at once, before the house or the database answers. If it fails,
 * the list comes back as the server has it, with `problem`.
 */
export class Reorder<T extends { itemId: number }> {
	#order = $state<number[] | null>(null);
	#pending = 0;
	problem = $state('');

	constructor(private readonly items: () => T[]) {}

	get shown(): T[] {
		const items = this.items();
		const order = this.#order;
		if (!order) return items;
		const byId = new Map(items.map((i) => [i.itemId, i]));
		const placed = order.map((id) => byId.get(id)).filter((i) => i !== undefined);
		// Something new from the server, not in the order yet: at the end.
		return [...placed, ...items.filter((i) => !order.includes(i.itemId))];
	}

	move = async (itemId: number, beforeId: number | null) => {
		this.problem = '';
		this.#order = moveBefore(
			this.shown.map((i) => i.itemId),
			itemId,
			beforeId
		);
		this.#pending++;
		const body = new FormData();
		body.set('itemId', String(itemId));
		body.set('beforeId', beforeId === null ? '' : String(beforeId));
		try {
			const res = await fetch(`${location.pathname}?/move`, {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await res.text());
			if (result.type === 'failure')
				this.problem = String(result.data?.message ?? 'No se pudo mover');
			else if (result.type === 'error') this.problem = 'No se pudo mover';
			await invalidateAll();
		} catch {
			this.problem = 'Sin conexión: no se ha movido';
		} finally {
			if (--this.#pending === 0) this.#order = null;
		}
	};
}
