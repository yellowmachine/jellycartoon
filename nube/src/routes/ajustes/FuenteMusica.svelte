<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/**
	 * «De dónde sale tu música» (#534, phase 3): with the house and the family's own bucket, which one
	 * Música shows (its albums, its lists, its folders) and the voice plays from. Only then: with
	 * one, that one.
	 */
	let { data, tab }: { data: PageData; tab: string } = $props();

	const sources = $derived(data.musicSources);
	const options = [
		{ value: 'casa', label: 'La de casa', hint: 'La biblioteca de la casa, con sus listas' },
		{
			value: 'propia',
			label: 'Vuestro almacenamiento',
			hint: 'La que tenéis en vuestro S3, R2, Backblaze…, con sus propias listas'
		}
	] as const;
</script>

{#if sources.house && sources.own}
	<section class={section} id="fuente-musica">
		<h2 class="mb-1 font-semibold">Tu música, de dónde sale</h2>
		<p class="mb-3 text-sm text-zinc-400">
			En Música y en el modo carretera, sus álbumes y listas; y lo que pides por voz. Solo para ti.
		</p>
		<form
			method="post"
			action="?seccion={tab}&/musicSource"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="space-y-2"
		>
			{#each options as o (o.value)}
				<label class="flex items-start gap-2 text-sm">
					<input
						type="radio"
						name="source"
						value={o.value}
						checked={sources.current === o.value}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
						class="mt-0.5 border-zinc-700 bg-zinc-900 text-amber-500"
					/>
					<span>
						{o.label}
						<span class="block text-xs text-zinc-500">{o.hint}</span>
					</span>
				</label>
			{/each}
		</form>
	</section>
{/if}
