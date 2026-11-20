<script lang="ts">
	import { enhance } from '$app/forms';

	/**
	 * A button for what cannot be undone: pressed, it says what is lost and asks; only «Sí» sends the
	 * form to `action`, with `fields`. In its place by default; with `below`, the button stays and the
	 * question takes a line of its own under the row, as wide as it (the row must wrap: `flex-wrap`),
	 * so a row full of text is not squeezed (Paseos).
	 */
	let {
		action,
		fields = {},
		label,
		question,
		yes = 'Sí, borrar',
		below = false,
		class: className = ''
	}: {
		action: string;
		fields?: Record<string, string | number>;
		label: string;
		/** What is lost, in words. */
		question: string;
		yes?: string;
		/** The question on its own line under the row, not in the button's place. */
		below?: boolean;
		/** The first button's. */
		class?: string;
	} = $props();

	let asking = $state(false);
</script>

{#if asking && below}
	<button type="button" class="text-sm text-red-400" onclick={() => (asking = false)}
		>{label}</button
	>
{/if}
{#if asking}
	<form
		method="post"
		{action}
		class={[
			'flex flex-wrap items-center gap-x-3 gap-y-1 text-sm',
			below && 'order-last basis-full rounded-md bg-red-950/40 px-3 py-2'
		]}
		use:enhance={() =>
			async ({ update }) => {
				asking = false;
				await update();
			}}
	>
		{#each Object.entries(fields) as [name, value] (name)}
			<input type="hidden" {name} {value} />
		{/each}
		<span class="text-red-300">{question}</span>
		<button class="font-medium text-red-400 hover:underline">{yes}</button>
		<button type="button" class="text-zinc-400 hover:text-white" onclick={() => (asking = false)}
			>No</button
		>
	</form>
{:else}
	<button type="button" class={className} onclick={() => (asking = true)}>{label}</button>
{/if}
