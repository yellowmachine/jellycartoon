<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { onMount } from 'svelte';
	import { routeMaps } from 'comun/route-maps.svelte.ts';
	import { sizeText } from 'comun/route-maps.ts';
	import { offlineGames } from '#lib/offline-games.svelte.ts';
	import type { OfflineGamesView } from '#lib/offline-games.ts';

	/**
	 * A game to carry on a device, such as the car's tablet, to play it without coverage
	 * (offline-games.ts): ordered from any device, downloaded by that one when the app opens there.
	 */
	let {
		system,
		file,
		view,
		problem
	}: { system: string; file: string; view: OfflineGamesView; problem: string | null } = $props();

	let mounted = $state(false);
	onMount(() => (mounted = true));
	const here = $derived(mounted ? routeMaps.device : null);

	const carried = $derived(view.games.filter((g) => g.system === system && g.file === file));
	const free = $derived(view.devices.filter((d) => !carried.some((c) => c.deviceId === d.id)));
	let chosen = $state<string | null>(null);
	const deviceName = (id: string) => view.devices.find((d) => d.id === id)?.name ?? '?';

	/** Ordered for this same device: done at once. */
	const ordered: SubmitFunction = ({ formData }) => {
		const device = formData.get('device');
		return async ({ update }) => {
			await update({ reset: false });
			if (device === routeMaps.device?.id) void offlineGames.sync();
		};
	};

	const STATE = {
		pending: 'se baja cuando se abra la app allí',
		downloading: 'bajando',
		ready: 'listo',
		failed: 'falló'
	} as const;
</script>

<section class="mt-8 max-w-3xl">
	<h2 class="mb-1 font-semibold">Sin cobertura</h2>
	{#if !view.devices.length}
		<p class="text-sm text-zinc-400">
			Para jugarlo sin cobertura, ponle nombre a la tablet en <a
				href="/juegos"
				class="underline hover:text-white">Juegos</a
			>.
		</p>
	{:else}
		{#each carried as c (c.deviceId)}
			<p class="text-sm text-zinc-300">
				En {deviceName(c.deviceId)}:
				<span class={c.state === 'failed' ? 'text-red-300' : 'text-zinc-400'}>
					{STATE[c.state]}{c.state === 'ready' && c.bytes ? ` · ${sizeText(c.bytes)}` : ''}
					{#if c.state === 'failed'}· {c.problem}{/if}
				</span>
			</p>
		{/each}
		{#if free.length}
			<form
				method="post"
				action="?/offlineAdd"
				use:enhance={ordered}
				class="mt-2 flex flex-wrap items-center gap-2"
			>
				<label for="carry-device" class="text-sm text-zinc-400">Llevar en</label>
				<select
					id="carry-device"
					name="device"
					class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
					value={chosen ?? (free.find((d) => d.id === here?.id) ?? free[0]!).id}
					onchange={(e) => (chosen = e.currentTarget.value)}
				>
					{#each free as d (d.id)}
						<option value={d.id}>{d.name}</option>
					{/each}
				</select>
				<button class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
					>Llevar</button
				>
			</form>
		{/if}
		{#if problem}
			<p class="mt-2 text-sm text-red-400" role="alert">{problem}</p>
		{/if}
	{/if}
</section>
