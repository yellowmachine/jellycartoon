<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/**
	 * Each adult's own bar: which of the sections the family has they want in it. Taken out, it
	 * leaves their bar and its card on their home page; the page still opens and the voice still
	 * reaches it. What the family has is chosen in Familia → «Secciones de la familia».
	 */
	let { data, tab }: { data: PageData; tab: string } = $props();
</script>

{#if data.mySections.length}
	<section class={section} id="mi-barra">
		<h2 class="mb-1 font-semibold">Mi barra</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Las secciones que quieres ver arriba, entre las que tiene la familia. Quitar una no borra
			nada: la página se sigue abriendo y la voz sigue funcionando.
		</p>
		<form
			method="post"
			action="?seccion={tab}&/saveMySections"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false, invalidateAll: true })}
			class="grid gap-2 sm:grid-cols-2"
		>
			{#each data.mySections as s (s.path)}
				<input type="hidden" name="shown" value={s.path} />
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						name="on"
						value={s.path}
						checked={s.on}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
						class="rounded border-zinc-700 bg-zinc-900 text-amber-500"
					/>
					{s.label}
				</label>
			{/each}
		</form>
	</section>
{/if}
