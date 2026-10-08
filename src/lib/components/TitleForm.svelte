<script lang="ts">
	import { enhance } from '$app/forms';

	interface Props {
		/** Form action, e.g. `?/renameSeries`. */
		action: string;
		value: string;
		/** Shown when the field is empty; also what an empty field goes back to, if anything. */
		placeholder?: string;
		/** Extra hidden fields, e.g. the episode id. */
		hidden?: Record<string, string | number>;
		onclose: () => void;
	}

	let { action, value, placeholder, hidden = {}, onclose }: Props = $props();

	let input = $state<HTMLInputElement>();
	$effect(() => input?.select());
</script>

<form
	method="post"
	{action}
	use:enhance={() =>
		async ({ update }) => {
			await update({ reset: false });
			onclose();
		}}
	class="flex min-w-0 flex-1 items-center gap-2"
>
	{#each Object.entries(hidden) as [name, val] (name)}
		<input type="hidden" {name} value={val} />
	{/each}
	<input
		bind:this={input}
		name="title"
		{value}
		{placeholder}
		aria-label="Título"
		class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
		onkeydown={(e) => e.key === 'Escape' && onclose()}
	/>
	<button class="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950">
		Guardar
	</button>
	<button
		type="button"
		class="rounded-md px-2 py-1 text-sm text-zinc-400 hover:text-white"
		onclick={onclose}>Cancelar</button
	>
</form>
