<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { routeMaps } from 'comun/route-maps.svelte.ts';
	import { MAX_DEVICE_NAME, sizeText } from 'comun/route-maps.ts';
	import { offlineGames } from '#lib/offline-games.svelte.ts';
	import type { OfflineGamesView } from '#lib/offline-games.ts';

	/**
	 * Games without coverage (offline-games.ts): which games each device carries, such as the car's
	 * tablet, the same devices as the routes' maps and the music. Each is ordered from its own page
	 * («Llevar»); here, how they go, and away with them.
	 */
	let { view: given, problem }: { view: OfflineGamesView; problem: string | null } = $props();

	/** As the page gave it, or as asked again while a game goes down: from Seilide only. */
	let view = $derived(given);
	async function refresh() {
		const res = await fetch('/api/juegos/sin-conexion').catch(() => null);
		if (res?.ok) view = await res.json();
	}

	let mounted = $state(false);
	let name = $state('');
	let naming = $state(false);
	const here = $derived(mounted ? routeMaps.device : null);
	const deviceName = (id: string) => view.devices.find((d) => d.id === id)?.name ?? '?';

	onMount(() => {
		mounted = true;
		offlineGames.onchange = () => void refresh();
		return () => (offlineGames.onchange = null);
	});

	// Downloading on another device: how it goes, every few seconds.
	$effect(() => {
		const away = view.games.some(
			(g) =>
				(g.state === 'downloading' || g.state === 'pending') && g.deviceId !== routeMaps.device?.id
		);
		if (!away) return;
		const timer = setInterval(() => void refresh(), 5000);
		return () => clearInterval(timer);
	});

	async function register(e: SubmitEvent) {
		e.preventDefault();
		if (!name.trim()) return;
		naming = true;
		try {
			await routeMaps.register(name.trim());
			await invalidateAll();
		} finally {
			naming = false;
		}
	}

	const removed: SubmitFunction = ({ formData }) => {
		const device = formData.get('device');
		return async ({ update }) => {
			await update({ reset: false });
			if (device === routeMaps.device?.id) void offlineGames.sync();
		};
	};

	const STATE = {
		pending: 'pendiente',
		downloading: 'bajando',
		ready: 'listo',
		failed: 'falló'
	} as const;
</script>

<section class="mt-10 rounded-md border border-zinc-800 p-4">
	<h2 class="mb-1 text-xl font-semibold">En el coche, sin cobertura</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Un juego se guarda en un dispositivo, como la tablet del coche, y se juega aunque no haya
		cobertura, con la app abierta. Se pide desde la página del juego («Llevar»); lo baja él la
		próxima vez que se abra la app allí. Juegos y música, hasta 2 GB por dispositivo. Lo que se
		juegue sin cobertura se sube al volver la conexión.
	</p>

	<div class="mb-5 rounded-md bg-zinc-900 p-3 text-sm">
		{#if !mounted}
			…
		{:else if !offlineGames.supported}
			<p class="text-zinc-400">Este navegador no puede guardar juegos.</p>
		{:else if here}
			<p class="flex flex-wrap items-center gap-x-3 gap-y-1">
				<span>Este dispositivo: <b>{here.name}</b>.</span>
				{#if offlineGames.current}
					{@const now = offlineGames.current}
					<span class="text-amber-300">
						Bajando {offlineGames.find(now.system, now.file)?.title ?? ''}: {now.held} de {now.total}
						ficheros
					</span>
				{/if}
				{#if offlineGames.ready.length}
					<a
						href="/juegos/aqui"
						class="ml-auto rounded-md bg-lime-400 px-3 py-1 font-medium text-zinc-950 hover:bg-lime-300"
						>Jugar sin conexión ({offlineGames.ready.length})</a
					>
				{/if}
			</p>
		{:else}
			<form class="flex flex-wrap items-center gap-2" onsubmit={register}>
				<label for="games-device" class="text-zinc-300">¿Guardar juegos en este dispositivo?</label>
				<input
					id="games-device"
					bind:value={name}
					maxlength={MAX_DEVICE_NAME}
					placeholder="Tablet coche"
					class="min-w-40 flex-1 rounded-md border-zinc-700 bg-zinc-900 px-3 py-1 text-sm"
				/>
				<button
					class="rounded-md bg-amber-500 px-3 py-1 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
					disabled={naming || !name.trim()}>Sí, con este nombre</button
				>
			</form>
		{/if}
	</div>

	{#if problem}
		<p class="mb-3 text-sm text-red-400" role="alert">{problem}</p>
	{/if}

	{#if !view.games.length}
		<p class="text-sm text-zinc-500">Ningún dispositivo lleva juegos todavía.</p>
	{:else}
		<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
			{#each view.games as g (`${g.deviceId}/${g.system}/${g.file}`)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
					<a
						href="/juegos/{encodeURIComponent(g.system)}/{encodeURIComponent(g.file)}"
						class="font-medium hover:text-lime-300">{g.title}</a
					>
					<span class="text-zinc-400">{deviceName(g.deviceId)}</span>
					<span
						class={[
							'rounded-full px-2 py-0.5 text-xs',
							g.state === 'ready' && 'bg-emerald-900 text-emerald-200',
							(g.state === 'pending' || g.state === 'downloading') && 'bg-sky-900 text-sky-200',
							g.state === 'failed' && 'bg-red-950 text-red-300'
						]}>{STATE[g.state]}</span
					>
					<span class="text-zinc-500">
						{g.bytes ? sizeText(g.bytes) : ''}
						{#if g.state === 'failed'}· {g.problem}{/if}
					</span>
					<form method="post" action="?/offlineRemove" use:enhance={removed} class="ml-auto">
						<input type="hidden" name="system" value={g.system} />
						<input type="hidden" name="file" value={g.file} />
						<input type="hidden" name="device" value={g.deviceId} />
						<button class="text-sm text-zinc-400 hover:text-amber-300">Quitar</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>
