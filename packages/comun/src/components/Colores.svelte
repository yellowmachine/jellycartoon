<!--
@component
Los colores de la app, en todas tus pantallas: la misma sección en casa y en la nube (#253).
-->
<script lang="ts" module>
	export interface ColoresProps {
		/** El que tienes. */
		theme: string;
		/** La pestaña de Ajustes, para seguir en ella al guardar. */
		tab: string;
		/** Si no se pudo. */
		problem?: string | null;
		/** The classes of the section's box. */
		section?: string;
		/** Where the colours apply, said after «Los de toda la app». */
		where?: string;
		/** The light ones too: Seilide's. */
		light?: boolean;
	}
</script>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { isDarkTheme, THEMES, themeSwatches } from '../themes.ts';

	let {
		theme: current,
		tab,
		problem = null,
		section = 'mb-8 rounded-md border border-zinc-800 p-4',
		where = 'en todas tus pantallas, también en la tele del salón',
		light = false
	}: ColoresProps = $props();
</script>

<section class={section} id="colores">
	<h2 class="mb-1 font-semibold">Colores</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Los de toda la app, {where}.
	</p>
	<form
		method="post"
		action="?seccion={tab}&/theme"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
		class="grid gap-2 sm:grid-cols-2"
	>
		{#each THEMES.filter((t) => light || isDarkTheme(t.id)) as theme (theme.id)}
			{@const on = current === theme.id}
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
	{#if problem}
		<p class="mt-2 text-sm text-red-400">{problem}</p>
	{/if}
</section>
