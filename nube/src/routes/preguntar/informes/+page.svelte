<script lang="ts">
	import GuideLink from '#lib/components/GuideLink.svelte';
	import PreguntarTabs from '#lib/components/PreguntarTabs.svelte';
	import { daysText } from '#lib/report-days.ts';
	import type { PageProps } from './$types';

	/** Preguntar → Informes (#505): the reports asked for in the chat, kept. */
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Informes · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="mb-3 text-2xl font-bold">
		Preguntar<GuideLink page="preguntar#informes" label="los informes" />
	</h1>
	<PreguntarTabs />
	{#if !data.reports.length}
		<div class="text-zinc-400">
			<p>Aún no hay informes.</p>
			<p class="mt-2 text-sm">
				Pídelos en la <a href="/preguntar" class="text-amber-400 hover:underline">conversación</a>:
				«hazme un informe de mi último viaje a Alicante». Junta el mapa, las fotos, los gastos, la
				agenda y el tiempo de esos días, y se queda aquí guardado como estaba.
			</p>
		</div>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each data.reports as r (r.id)}
				<li>
					<a
						href="/preguntar/informes/{r.id}"
						class="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 hover:border-amber-500/60"
					>
						<span class="min-w-0">
							<span class="block truncate font-medium text-zinc-100">{r.title}</span>
							<span class="block text-sm text-zinc-400">{daysText(r.from, r.to)}</span>
						</span>
						<span class="shrink-0 text-amber-400">→</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
