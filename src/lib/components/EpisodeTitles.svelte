<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import type { TitleProposal } from '#lib/episode-titles.ts';

	interface Row extends TitleProposal {
		now: {
			season: number;
			number: number;
			title: string;
			customTitle: string | null;
			sourcePath: string;
		};
	}

	interface Props {
		proposal: {
			/** Batches sent to the AI, while it works. */
			progress: { done: number; total: number } | null;
			failed: string | null;
			rows: Row[];
		};
		/** There is an OpenRouter key and the series has its info. */
		canPropose: boolean;
	}

	let { proposal, canPropose }: Props = $props();

	const season = (p: TitleProposal) => (p.isEpisode ? p.season : 0);
	const changed = $derived(
		proposal.rows.filter(
			(r) =>
				!r.isEpisode ||
				r.season !== r.now.season ||
				r.number !== r.now.number ||
				r.title !== r.now.title
		)
	);
	const chosen = new SvelteSet<number>();
	// Everything that changes is chosen when a new proposal arrives, not each time the page reloads.
	const proposalKey = $derived(changed.map((r) => r.episodeId).join());
	$effect(() => {
		chosen.clear();
		for (const id of proposalKey.split(',').filter(Boolean)) chosen.add(Number(id));
	});

	// Until the AI is done.
	$effect(() => {
		if (!proposal.progress) return;
		const timer = setInterval(invalidateAll, 3000);
		return () => clearInterval(timer);
	});

	const button = 'rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900';
</script>

<section class="mb-8">
	{#if proposal.progress}
		<p class="text-sm text-amber-400">
			La IA está leyendo la lista de episodios y mirando unos fotogramas de cada uno{#if proposal.progress.total}:
				lote {proposal.progress.done + 1} de {proposal.progress.total}{/if}…
		</p>
	{:else if proposal.rows.length}
		<h2 class="mb-1 font-semibold">Títulos propuestos por la IA</h2>
		<p class="mb-3 text-sm text-zinc-400">
			{#if changed.length}
				Cambiarían {changed.length} de {proposal.rows.length}. Se aplica lo marcado y el resto se
				descarta; la temporada y el número aplicados ya no los cambia el escaneo. Lo que no es un
				episodio va a la temporada 0.
			{:else}
				La IA lo dejaría todo como está.
			{/if}
		</p>
		<form
			method="post"
			action="?/applyTitles"
			use:enhance
			class="rounded-md border border-zinc-800"
		>
			{#if changed.length}
				<div class="flex flex-wrap items-center gap-3 border-b border-zinc-800 p-3 text-sm">
					<button
						type="button"
						class="text-zinc-400 hover:text-white"
						onclick={() => changed.forEach((r) => chosen.add(r.episodeId))}>Marcar todo</button
					>
					<button
						type="button"
						class="text-zinc-400 hover:text-white"
						onclick={() => chosen.clear()}>Desmarcar todo</button
					>
				</div>
				<ul class="max-h-[60vh] divide-y divide-zinc-800 overflow-y-auto">
					{#each changed as row (row.episodeId)}
						<li>
							<label class="flex cursor-pointer items-start gap-3 p-3 hover:bg-zinc-900">
								<input
									type="checkbox"
									name="id"
									value={row.episodeId}
									class="mt-1 rounded border-zinc-600 bg-zinc-900 text-amber-500"
									checked={chosen.has(row.episodeId)}
									onchange={(e) =>
										e.currentTarget.checked
											? chosen.add(row.episodeId)
											: chosen.delete(row.episodeId)}
								/>
								<span class="min-w-0 flex-1 text-sm">
									<span class="block truncate text-xs text-zinc-500">{row.now.sourcePath}</span>
									<span class="block text-zinc-400">
										T{row.now.season}x{row.now.number} · {row.now.title}
									</span>
									<span class="block">
										→
										<span
											class={season(row) !== row.now.season || row.number !== row.now.number
												? 'text-amber-400'
												: ''}
										>
											{#if row.isEpisode}T{row.season}x{row.number}{:else}No es un episodio{/if}
										</span>
										·
										<span class={row.title !== row.now.title ? 'text-amber-400' : ''}
											>{row.title}</span
										>
									</span>
									{#if row.now.customTitle}
										<span class="block text-xs text-zinc-500">
											Le pusiste el título a mano: sigue mandando sobre el de la IA.
										</span>
									{/if}
								</span>
							</label>
						</li>
					{/each}
				</ul>
			{/if}
			<div class="flex flex-wrap items-center gap-2 border-t border-zinc-800 p-3">
				{#if changed.length}
					<button
						disabled={chosen.size === 0}
						class="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
					>
						Aplicar {chosen.size}
					</button>
				{/if}
				<button formaction="?/discardTitles" class={button}>Descartar</button>
			</div>
		</form>
	{:else if canPropose}
		<form
			method="post"
			action="?/proposeTitles"
			use:enhance
			class="flex flex-wrap items-center gap-3"
		>
			<button class={button}>Poner títulos y numeración con la IA</button>
			<span class="text-xs text-zinc-500">
				Lee la lista de episodios de Wikipedia y mira unos fotogramas de cada uno. Lo revisas antes
				de aplicarlo.
			</span>
		</form>
	{/if}
	{#if proposal.failed}
		<p class="mt-2 text-sm text-red-400">No se pudieron proponer los títulos: {proposal.failed}</p>
	{/if}
</section>
