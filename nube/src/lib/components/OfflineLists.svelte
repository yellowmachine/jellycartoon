<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { routeMaps } from 'comun/route-maps.svelte.ts';
	import { MAX_DEVICE_NAME, sizeText } from 'comun/route-maps.ts';
	import { offlineMusic } from '#lib/offline-music.svelte.ts';
	import { MAX_OFFLINE_BYTES, type OfflineListsView } from '#lib/offline-music.ts';
	import type { PlaylistSummary } from '#lib/server/music.ts';

	/**
	 * Music without coverage (#350): the house's lists carried on a device, such as the car's tablet,
	 * the same devices as the routes' maps. Ordered from any device; the one that carries them does
	 * it when the app opens there, and keeps them up to date as the lists change.
	 */
	let {
		lists,
		view,
		problem
	}: { lists: PlaylistSummary[]; view: OfflineListsView; problem: string | null } = $props();

	let mounted = $state(false);
	let name = $state('');
	let naming = $state(false);
	/** Device chosen for each list's «Llevar en». */
	let chosen = $state<Record<number, string>>({});

	const here = $derived(mounted ? routeMaps.device : null);
	const deviceName = (id: string) => view.devices.find((d) => d.id === id)?.name ?? '?';
	/** What each device carries, all its lists. */
	const used = $derived(
		new Map(
			view.devices.map((d) => [
				d.id,
				view.lists.filter((l) => l.deviceId === d.id).reduce((sum, l) => sum + l.bytes, 0)
			])
		)
	);

	onMount(() => {
		mounted = true;
		offlineMusic.onchange = () => void invalidateAll();
		return () => (offlineMusic.onchange = null);
	});

	// Downloading on another device: how it goes, every few seconds.
	$effect(() => {
		const away = view.lists.some(
			(l) =>
				(l.state === 'downloading' || l.state === 'pending') && l.deviceId !== routeMaps.device?.id
		);
		if (!away) return;
		const timer = setInterval(() => void invalidateAll(), 5000);
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

	/** Ordered for this same device: done at once. */
	const ordered: SubmitFunction = ({ formData }) => {
		const device = formData.get('device');
		return async ({ update }) => {
			await update({ reset: false });
			if (device === routeMaps.device?.id) void offlineMusic.sync();
		};
	};

	const STATE = {
		pending: 'pendiente',
		downloading: 'bajando',
		ready: 'lista',
		failed: 'falló'
	} as const;

	const select = 'rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm';
	const small = 'text-sm text-zinc-400 hover:text-amber-300';
</script>

<section class="mt-10 rounded-md border border-zinc-800 p-4">
	<h2 class="mb-1 text-xl font-semibold">En el coche, sin cobertura</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Una lista se guarda entera en un dispositivo, como la tablet del coche, y suena aunque no haya
		cobertura. Se pone al día sola cuando cambia la lista. Hasta 2 GB por dispositivo (unas 500
		canciones). Se pide desde cualquier dispositivo; lo baja él la próxima vez que se abra la app
		allí.
	</p>

	<div class="mb-5 rounded-md bg-zinc-900 p-3 text-sm">
		{#if !mounted}
			…
		{:else if !offlineMusic.supported}
			<p class="text-zinc-400">Este navegador no puede guardar música.</p>
		{:else if here}
			<p>
				Este dispositivo: <b>{here.name}</b>.
				{#if offlineMusic.current}
					<span class="text-amber-300">
						Bajando {lists.find((l) => l.id === offlineMusic.current?.playlistId)?.name ?? ''}: {offlineMusic
							.current.held} de {offlineMusic.current.total}
					</span>
				{/if}
			</p>
		{:else}
			<form class="flex flex-wrap items-center gap-2" onsubmit={register}>
				<label for="music-device" class="text-zinc-300">¿Guardar música en este dispositivo?</label>
				<input
					id="music-device"
					bind:value={name}
					maxlength={MAX_DEVICE_NAME}
					placeholder="Tablet coche"
					class="{select} min-w-0 flex-1 px-3"
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

	{#if !view.devices.length}
		<p class="text-sm text-zinc-500">
			Todavía no hay ningún dispositivo que guarde música: ábrelo en la tablet y dale un nombre.
		</p>
	{:else if lists.length}
		<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
			{#each lists as list (list.id)}
				{@const carried = view.lists.filter((l) => l.playlistId === list.id)}
				{@const free = view.devices.filter((d) => !carried.some((c) => c.deviceId === d.id))}
				<li class="flex flex-col gap-2 p-3">
					<div class="flex flex-wrap items-center gap-2">
						<span class="mr-auto font-medium">{list.name}</span>
						{#if free.length && list.total}
							<form
								method="post"
								action="?/offlineAdd"
								use:enhance={ordered}
								class="flex items-center gap-2"
							>
								<input type="hidden" name="list" value={list.id} />
								<select
									name="device"
									class={select}
									aria-label="Dispositivo para {list.name}"
									value={chosen[list.id] ?? (free.find((d) => d.id === here?.id) ?? free[0]!).id}
									onchange={(e) => (chosen[list.id] = e.currentTarget.value)}
								>
									{#each free as d (d.id)}
										<option value={d.id}>{d.name}</option>
									{/each}
								</select>
								<button
									class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
									>Llevar</button
								>
							</form>
						{/if}
					</div>
					{#each carried as c (c.deviceId)}
						{@const local =
							c.deviceId === here?.id && offlineMusic.current?.playlistId === list.id
								? offlineMusic.current
								: null}
						<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
							<span class="text-zinc-300">{deviceName(c.deviceId)}</span>
							<span
								class={[
									'rounded-full px-2 py-0.5 text-xs',
									c.state === 'ready' && 'bg-emerald-900 text-emerald-200',
									(c.state === 'pending' || c.state === 'downloading') && 'bg-sky-900 text-sky-200',
									c.state === 'failed' && 'bg-red-950 text-red-300'
								]}
							>
								{local ? 'bajando' : STATE[c.state]}
							</span>
							<span class="text-zinc-500">
								{#if local}
									{local.held} de {local.total} canciones
								{:else if c.state === 'pending'}
									se baja cuando se abra la app allí
								{:else}
									{c.held} de {c.total} canciones{c.bytes ? ` · ${sizeText(c.bytes)}` : ''}
									{#if c.state === 'failed'}· {c.problem}{/if}
								{/if}
							</span>
							<form method="post" action="?/offlineRemove" use:enhance={ordered} class="ml-auto">
								<input type="hidden" name="list" value={list.id} />
								<input type="hidden" name="device" value={c.deviceId} />
								<button class={small}>Quitar</button>
							</form>
						</div>
					{/each}
				</li>
			{/each}
		</ul>
		<ul class="mt-3 flex flex-col gap-1 text-xs text-zinc-500">
			{#each view.devices as d (d.id)}
				{#if used.get(d.id)}
					<li>
						{d.name}: {sizeText(used.get(d.id)!)} de {sizeText(MAX_OFFLINE_BYTES)}
					</li>
				{/if}
			{/each}
		</ul>
	{/if}
</section>
