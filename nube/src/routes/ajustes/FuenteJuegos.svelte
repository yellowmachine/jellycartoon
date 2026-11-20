<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/**
	 * «Tus juegos, de dónde salen» (#564): with the house and the family's own bucket, which one
	 * Juegos shows, as the music (FuenteMusica). Only then: with one, that one.
	 */
	let { data, tab }: { data: PageData; tab: string } = $props();

	const sources = $derived(data.gameSources);
	const options = [
		{ value: 'casa', label: 'Los de casa', hint: 'Los de la casa, con las partidas de la tele' },
		{
			value: 'propia',
			label: 'Vuestro almacenamiento',
			hint: 'Los que tenéis en vuestro S3, R2, Backblaze…, con sus propias partidas'
		}
	] as const;
</script>

{#if sources.house && sources.own}
	<section class={section} id="fuente-juegos">
		<h2 class="mb-1 font-semibold">Tus juegos, de dónde salen</h2>
		<p class="mb-3 text-sm text-zinc-400">
			En Juegos, sus consolas y sus partidas. Cada sitio guarda las suyas. Solo para ti.
		</p>
		<form
			method="post"
			action="?seccion={tab}&/gameSource"
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
