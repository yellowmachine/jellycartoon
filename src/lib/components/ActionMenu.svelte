<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Unique on the page: links the button with its menu. */
		id: string;
		/** The menu's rows, given a function that closes it. */
		children: Snippet<[close: () => void]>;
	}

	let { id, children }: Props = $props();

	let menu = $state<HTMLElement>();
	const close = () => menu?.hidePopover();
</script>

<!-- Native popover: closes with Esc or a click outside, positioned next to its button. -->
<button
	class="shrink-0 rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
	title="Más acciones"
	aria-label="Más acciones"
	popovertarget={id}
	style:anchor-name="--{id}">⋯</button
>

<div
	bind:this={menu}
	{id}
	popover="auto"
	style:position-anchor="--{id}"
	class="action-menu inset-auto m-0 mt-1 w-64 rounded-md border border-zinc-700 bg-zinc-900 p-1 text-sm shadow-lg"
>
	{@render children(close)}
</div>

<style>
	/* Below the button, aligned to its right edge; above it if there is no room underneath. */
	.action-menu {
		position-area: bottom span-left;
		position-try-fallbacks: flip-block;
	}
</style>
