<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/**
	 * Oración (#339): en la barra de toda la familia, peques incluidos, solo si quien la administra
	 * lo enciende.
	 */
	let { data, tab }: { data: PageData; tab: string } = $props();
</script>

{#if data.prayerMode !== null}
	<section class={section} id="oracion">
		<h2 class="mb-1 font-semibold">Oración</h2>
		<form
			method="post"
			action="?seccion={tab}&/savePrayerMode"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false, invalidateAll: true })}
		>
			<label class="flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					name="on"
					checked={data.prayerMode}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
					class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
				/>
				<span>
					Oración en la barra
					<span class="block text-xs text-zinc-500"
						>Para pegar oraciones y letanías, darles voz con la IA y rezarlas en listas. La ve toda
						la familia; los peques solo las escuchan.</span
					>
				</span>
			</label>
		</form>
	</section>
{/if}
