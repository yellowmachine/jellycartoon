<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/**
	 * What the whole family has in its bar, children included: only who runs it changes it. Turned
	 * off, a section leaves the bar and its card on the home page; nothing is deleted, and voice and
	 * links still reach it, but for Oración (#339), which does not open at all.
	 */
	let { data, tab }: { data: PageData; tab: string } = $props();
</script>

{#if data.sections}
	<section class={section} id="secciones">
		<h2 class="mb-1 font-semibold">Secciones de la barra</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Para toda la familia, peques incluidos. Quitar una no borra nada, y la voz sigue funcionando.
		</p>
		<form
			method="post"
			action="?seccion={tab}&/saveSections"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false, invalidateAll: true })}
			class="grid gap-2 sm:grid-cols-2"
		>
			{#each data.sections as s (s.path)}
				<label class={['flex items-start gap-2 text-sm', s.about && 'sm:col-span-2']}>
					<input
						type="checkbox"
						name="on"
						value={s.path}
						checked={s.on}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
						class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
					/>
					<span>
						{s.label}
						{#if s.about}<span class="block text-xs text-zinc-500">{s.about}</span>{/if}
					</span>
				</label>
			{/each}
		</form>
	</section>
{/if}
