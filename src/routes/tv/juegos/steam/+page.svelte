<script lang="ts">
	import TvHeader from '#lib/components/TvHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** What happened with the last one chosen: Big Picture comes over this page once it opens. */
	let status = $state<{ text: string; failed: boolean } | null>(null);

	async function launch(game: { appid: number; name: string }) {
		status = { text: `Abriendo «${game.name}» en Steam…`, failed: false };
		const res = await fetch(`/api/juegos/steam/${game.appid}`, { method: 'POST' }).catch(
			() => null
		);
		if (!res?.ok) {
			const text = res ? (await res.json().catch(() => null))?.message : 'Sin conexión';
			status = { text: text ?? 'No se pudo abrir el juego', failed: true };
		}
	}
</script>

<svelte:head>
	<title>Steam · JellyCartoon</title>
</svelte:head>

<TvHeader title="Steam" />

{#if !data.canLaunch}
	<p class="mb-8 text-xl text-amber-300">
		Sin el servicio de Steam en el PC del salón (STEAM_SOCKET): los juegos no se pueden abrir desde
		aquí.
	</p>
{/if}
{#if status}
	<p class={['mb-8 text-2xl', status.failed ? 'text-red-300' : 'text-sky-300']} role="status">
		{status.text}
	</p>
{/if}

<div class="grid grid-cols-6 gap-8">
	{#each data.games as g (g.appid)}
		<button
			type="button"
			onclick={() => launch(g)}
			disabled={!data.canLaunch}
			class="group block rounded-lg text-left transition-transform duration-150 focus-visible:scale-105"
		>
			<div class="aspect-[2/3] overflow-hidden rounded-lg bg-zinc-800">
				<img src={g.cover} alt="" loading="lazy" class="h-full w-full object-cover" />
			</div>
			<p class="mt-2 truncate font-semibold group-focus-visible:text-sky-300">{g.name}</p>
		</button>
	{/each}
</div>
