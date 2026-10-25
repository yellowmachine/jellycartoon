<script lang="ts">
	import { enhance } from '$app/forms';
	import { THEMES, themeSwatches } from '#lib/themes.ts';
	import { section } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Los colores de la app, en todas tus pantallas. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

<section class={section} id="colores">
	<h2 class="mb-1 font-semibold">Colores</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Los de toda la app, en todas tus pantallas, también en la tele del salón.
	</p>
	<form
		method="post"
		action="?seccion={tab}&/theme"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
		class="grid gap-2 sm:grid-cols-2"
	>
		{#each THEMES as theme (theme.id)}
			{@const on = data.theme === theme.id}
			<button
				name="theme"
				value={theme.id}
				aria-pressed={on}
				class={[
					'flex items-center gap-3 rounded-md border p-2 text-left text-sm',
					on ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-800 hover:bg-zinc-900'
				]}
			>
				<!-- Its own colours, whatever theme is on now. -->
				<span class="flex shrink-0 overflow-hidden rounded border border-zinc-700">
					{#each themeSwatches(theme.id) as color, i (i)}
						<span class="h-6 w-3" style:background-color={color}></span>
					{/each}
				</span>
				<span class="flex-1">{theme.name}</span>
				{#if on}<span class="text-amber-400">✓</span>{/if}
			</button>
		{/each}
	</form>
	{#if form && 'section' in form && form.section === 'theme'}
		<p class="mt-2 text-sm text-red-400">{form.message}</p>
	{/if}
</section>
