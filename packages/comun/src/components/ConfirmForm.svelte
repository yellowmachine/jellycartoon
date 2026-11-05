<script lang="ts">
	import { enhance } from '$app/forms';

	/**
	 * A button for what cannot be undone: pressed, it says what is lost and asks; only «Sí» sends the
	 * form to `action`, with `fields`.
	 */
	let {
		action,
		fields = {},
		label,
		question,
		yes = 'Sí, borrar',
		class: className = ''
	}: {
		action: string;
		fields?: Record<string, string | number>;
		label: string;
		/** What is lost, in words. */
		question: string;
		yes?: string;
		/** The first button's. */
		class?: string;
	} = $props();

	let asking = $state(false);
</script>

{#if asking}
	<form
		method="post"
		{action}
		class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
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
