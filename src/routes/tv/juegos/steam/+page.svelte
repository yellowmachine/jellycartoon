<script lang="ts">
	import TvHeader from '#lib/components/TvHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** What happened with the last one chosen: Big Picture comes over this page once it opens. */
	let status = $state<{ text: string; failed: boolean } | null>(null);

	async function launch(game: { appid: number; name: string }) {
		await open(`/api/juegos/steam/${game.appid}`, `Abriendo «${game.name}» en Steam…`);
	}

	/** Big Picture alone: Steam's library and store, to browse; the remote's power button comes back. */
	async function bigPicture() {
		await open('/api/juegos/steam/bigpicture', 'Abriendo Steam en Big Picture…');
	}

	async function open(url: string, text: string) {
		status = { text, failed: false };
		const res = await fetch(url, { method: 'POST' }).catch(() => null);
		if (!res?.ok) {
			const text = res ? (await res.json().catch(() => null))?.message : 'Sin conexión';
			status = { text: text ?? 'No se pudo abrir Steam', failed: true };
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
	<button
		type="button"
		onclick={bigPicture}
		disabled={!data.canLaunch}
		class="group block rounded-lg text-left transition-transform duration-150 focus-visible:scale-105"
	>
		<div
			class="flex aspect-[2/3] flex-col items-center justify-center gap-3 rounded-lg bg-gradient-to-br from-sky-700 via-slate-800 to-zinc-900 p-4 text-center"
		>
			<span class="text-4xl font-bold text-white">Steam</span>
			<span class="text-lg text-sky-200">Biblioteca y tienda</span>
		</div>
		<p class="mt-2 truncate font-semibold group-focus-visible:text-sky-300">Big Picture</p>
	</button>
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
