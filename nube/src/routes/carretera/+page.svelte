<script lang="ts">
	import { duration, fold, type MusicTrack } from '#lib/music.ts';
	import { roadPlayer as player } from '#lib/road-player.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Tab = 'albumes' | 'listas' | 'radio';
	let tab = $state<Tab>('albumes');
	let search = $state('');
	/** An album or playlist opened, with its songs. */
	let open = $state<{ title: string; subtitle: string; tracks: MusicTrack[] } | null>(null);
	let loading = $state(false);
	let problem = $state<string | null>(null);

	let a = $state<HTMLAudioElement>();
	let b = $state<HTMLAudioElement>();

	$effect(() => player.setPass(data.pass));
	$effect(() => {
		if (!a || !b) return;
		player.attach(a, b, async () => {
			const res = await fetch('/api/musica/pase', { method: 'POST' });
			return res.ok ? res.json() : null;
		});
	});

	const albums = $derived(
		search.trim()
			? data.albums.filter((al) => fold(`${al.title} ${al.artist}`).includes(fold(search.trim())))
			: data.albums
	);

	async function openTracks(url: string, title: string, subtitle: string) {
		loading = true;
		problem = null;
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? res.statusText);
			open = { title, subtitle, tracks: (await res.json()).tracks };
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	async function playStation(uuid: string) {
		problem = null;
		const res = await fetch(`/api/radio/${uuid}`);
		if (!res.ok) {
			problem = 'La emisora no contesta ahora';
			return;
		}
		await player.playRadio(await res.json());
	}

	/** The screen on, while driving: a phone on the dashboard is looked at, not touched. */
	let wake = $state<WakeLockSentinel | null>(null);
	async function toggleScreen() {
		if (wake) {
			await wake.release();
			wake = null;
			return;
		}
		try {
			wake = await navigator.wakeLock.request('screen');
			wake.addEventListener('release', () => (wake = null));
		} catch {
			problem = 'Este navegador no deja la pantalla encendida';
		}
	}

	const current = $derived(player.current);
	const cover = $derived(player.radio?.favicon ?? player.cover(current));
	const tabClass = (t: Tab) =>
		`rounded-full px-5 py-2 text-base ${tab === t ? 'bg-amber-500 font-semibold text-zinc-950' : 'bg-zinc-800 text-zinc-200'}`;
	const round =
		'flex h-14 w-14 items-center justify-center rounded-full text-2xl disabled:opacity-40';
	const big = `${round} bg-zinc-800 hover:bg-zinc-700`;
	const main = `${round} bg-amber-500 text-zinc-950 hover:bg-amber-400`;
</script>

<svelte:head>
	<title>Carretera · Nube</title>
</svelte:head>

<audio bind:this={a} preload="auto"></audio>
<audio bind:this={b} preload="auto"></audio>

<div class="pb-40">
	<div class="mb-4 flex items-center justify-between gap-2">
		<h1 class="text-2xl font-bold">Carretera</h1>
		<button
			class="rounded-md px-3 py-2 text-sm {wake ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800'}"
			onclick={toggleScreen}>{wake ? '☀ Pantalla encendida' : '☀ Mantener la pantalla'}</button
		>
	</div>

	{#if data.problem}
		<p class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
			Sin la música de casa: {data.problem} La radio sí funciona.
		</p>
	{/if}
	{#if problem || player.problem}
		<p class="mb-4 text-sm text-red-400" role="alert">{problem ?? player.problem}</p>
	{/if}

	{#if open}
		<button class="mb-3 text-zinc-400 hover:text-white" onclick={() => (open = null)}
			>← Volver</button
		>
		<h2 class="text-xl font-semibold">{open.title}</h2>
		<p class="mb-4 text-sm text-zinc-400">{open.subtitle}</p>
		<button
			class="mb-4 rounded-md bg-amber-500 px-6 py-3 text-lg font-semibold text-zinc-950 hover:bg-amber-400"
			onclick={() => open && player.play(open.tracks)}>▶ Escuchar</button
		>
		<ol class="divide-y divide-zinc-800">
			{#each open.tracks as t, i (`${t.id}-${i}`)}
				<li>
					<button
						class="flex w-full items-center gap-3 py-3 text-left {current?.id === t.id
							? 'text-amber-400'
							: ''}"
						onclick={() => open && player.play(open.tracks, i)}
					>
						<span class="w-6 text-right text-zinc-500">{i + 1}</span>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-base">{t.title}</span>
							<span class="block truncate text-xs text-zinc-500">{t.artist}</span>
						</span>
						<span class="text-sm text-zinc-500 tabular-nums">{duration(t.durationSec)}</span>
					</button>
				</li>
			{/each}
		</ol>
	{:else}
		<div class="mb-4 flex gap-2">
			<button class={tabClass('albumes')} onclick={() => (tab = 'albumes')}>Álbumes</button>
			<button class={tabClass('listas')} onclick={() => (tab = 'listas')}>Listas</button>
			<button class={tabClass('radio')} onclick={() => (tab = 'radio')}>Radio</button>
		</div>

		{#if tab === 'albumes'}
			<input
				type="search"
				bind:value={search}
				placeholder="Buscar álbum o artista"
				aria-label="Buscar álbum o artista"
				class="mb-4 w-full rounded-md border-zinc-700 bg-zinc-900 py-3 text-base"
			/>
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
				{#each albums as al (al.id)}
					<button
						class="group min-w-0 text-left disabled:opacity-50"
						disabled={loading}
						onclick={() =>
							openTracks(
								`/api/musica/albumes/${al.id}`,
								al.title,
								`${al.artist} · ${al.tracks} canciones · ${duration(al.durationSec)}`
							)}
					>
						{#if al.hasCover && data.pass}
							<img
								src="{data.pass.base}/portadas/{al.id}"
								alt=""
								loading="lazy"
								class="mb-2 aspect-square w-full rounded-md bg-zinc-800 object-cover group-hover:opacity-80"
							/>
						{:else}
							<span
								class="mb-2 flex aspect-square w-full items-center justify-center rounded-md bg-zinc-800 text-4xl"
								aria-hidden="true">💿</span
							>
						{/if}
						<span class="block truncate text-sm">{al.title}</span>
						<span class="block truncate text-xs text-zinc-500">{al.artist}</span>
					</button>
				{:else}
					<p class="col-span-full text-sm text-zinc-400">
						{search ? 'Ninguno con esas palabras.' : 'No hay álbumes.'}
					</p>
				{/each}
			</div>
		{:else if tab === 'listas'}
			<ul class="divide-y divide-zinc-800">
				{#each data.playlists as l (l.id)}
					<li>
						<button
							class="flex w-full items-center justify-between gap-3 py-4 text-left disabled:opacity-50"
							disabled={loading || !l.total}
							onclick={() =>
								openTracks(
									`/api/musica/listas/${l.id}`,
									l.name,
									`${l.total} canciones · ${duration(l.durationSec)}`
								)}
						>
							<span class="text-base">{l.name}</span>
							<span class="text-sm text-zinc-500">{l.total}</span>
						</button>
					</li>
				{:else}
					<li class="py-3 text-sm text-zinc-400">No hay listas.</li>
				{/each}
			</ul>
		{:else}
			<ul class="grid gap-2 sm:grid-cols-2">
				{#each data.stations as s (s.uuid)}
					<li>
						<button
							class="w-full rounded-md border px-4 py-3 text-left {player.radio?.uuid === s.uuid
								? 'border-amber-500 text-amber-300'
								: 'border-zinc-800 hover:border-zinc-600'}"
							onclick={() => playStation(s.uuid)}
						>
							<span class="block text-base">{s.name}</span>
							<span class="block text-xs text-zinc-500">{s.description}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>

{#if current || player.radio}
	<div class="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur">
		<div class="mx-auto max-w-3xl px-4 py-3">
			{#if current}
				<input
					type="range"
					min="0"
					max={player.durationSec || 0}
					step="1"
					value={player.positionSec}
					oninput={(e) => player.seek(Number(e.currentTarget.value))}
					aria-label="Posición en la canción"
					class="mb-2 w-full accent-amber-500"
				/>
			{/if}
			<div class="flex items-center gap-3">
				{#if cover}
					<img src={cover} alt="" class="h-14 w-14 shrink-0 rounded-md bg-zinc-800 object-cover" />
				{/if}
				<div class="min-w-0 flex-1">
					<p class="truncate text-base font-semibold">{player.radio?.name ?? current?.title}</p>
					<p class="truncate text-sm text-zinc-400">
						{#if player.radio}Radio{:else if current}{current.artist} · {duration(
								player.positionSec
							)} / {duration(player.durationSec || current.durationSec)}{/if}
					</p>
				</div>
				{#if !player.radio}
					<button
						class={big}
						onclick={() => player.previous()}
						aria-label="Anterior"
						title="Anterior">⏮</button
					>
				{/if}
				<button
					class={main}
					onclick={() => player.toggle()}
					aria-label={player.playing ? 'Pausa' : 'Seguir'}>{player.playing ? '⏸' : '▶'}</button
				>
				{#if !player.radio}
					<button
						class={big}
						onclick={() => player.next()}
						disabled={player.index + 1 >= player.queue.length}
						aria-label="Siguiente"
						title="Siguiente">⏭</button
					>
				{/if}
			</div>
		</div>
	</div>
{/if}
