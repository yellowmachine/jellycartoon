<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** Unique on the page: links the button with its menu. */
		id: string;
		/** The menu's rows, given a function that closes it. */
		children: Snippet<[close: () => void]>;
		/** Just the dots, without the circle behind them. */
		plain?: boolean;
		/** Instead of the dots, e.g. a «+». */
		icon?: Snippet;
		/** The button's tooltip and label. */
		label?: string;
	}

	let { id, children, plain = false, icon, label = 'Más acciones' }: Props = $props();

	let menu = $state<HTMLElement>();
	const close = () => menu?.hidePopover();
</script>

<!-- Native popover: closes with Esc or a click outside, positioned next to its button. -->
<!-- Big enough for a finger and visible on the dark background. -->
<button
	class={[
		'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-zinc-200 hover:text-white',
		!plain && 'bg-zinc-800 hover:bg-zinc-700'
	]}
	title={label}
	aria-label={label}
	popovertarget={id}
	style:anchor-name="--{id}"
>
	{#if icon}
		{@render icon()}
	{:else}
		<svg viewBox="0 0 24 24" class="h-5 w-5" fill="currentColor" aria-hidden="true">
			<circle cx="5" cy="12" r="2.2" />
			<circle cx="12" cy="12" r="2.2" />
			<circle cx="19" cy="12" r="2.2" />
		</svg>
	{/if}
</button>

<div
	bind:this={menu}
	{id}
	popover="auto"
	style:position-anchor="--{id}"
	class="action-menu inset-auto m-0 mt-1 w-64 rounded-md border border-zinc-700 bg-zinc-900 p-1 text-sm text-zinc-100 shadow-lg"
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
