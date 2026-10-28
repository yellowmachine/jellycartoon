<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { routeMaps } from 'comun/route-maps.svelte.ts';
	import { MAX_DEVICE_NAME, sizeText, type RouteMapsView } from 'comun/route-maps.ts';
	import type { SavedRoute } from 'comun/saved-places.ts';

	/**
	 * Routes' maps on the devices (#164): a tablet as the car's GPS, its map without coverage along
	 * a route. Ordered from any device; the one that keeps them does it when the app opens there.
	 */
	let {
		routes,
		view,
		problem
	}: { routes: SavedRoute[]; view: RouteMapsView; problem: string | null } = $props();

	let mounted = $state(false);
	let name = $state('');
	let naming = $state(false);
	let forgetting = $state<string | null>(null);
	/** Device chosen for each route's «Bajar en». */
	let chosen = $state<Record<number, string>>({});

	const here = $derived(mounted ? routeMaps.device : null);
	const day = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' });
	const deviceName = (id: string) => view.devices.find((d) => d.id === id)?.name ?? '?';

	onMount(() => {
		mounted = true;
		routeMaps.onchange = () => void invalidateAll();
		return () => (routeMaps.onchange = null);
	});

	// Downloading on another device: how it goes, every few seconds.
	$effect(() => {
		const away = view.maps.some(
			(m) =>
				(m.state === 'downloading' || m.state === 'pending') && m.deviceId !== routeMaps.device?.id
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
			forgetting = null;
			if (device === routeMaps.device?.id) void routeMaps.sync();
		};
	};

	const STATE = {
		pending: 'pendiente',
		downloading: 'bajando',
		ready: 'descargado',
		failed: 'falló',
		remove: 'se quitará'
	} as const;

	const select = 'rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm';
	const small = 'text-sm text-zinc-400 hover:text-amber-300';
</script>

<section class="mb-10 rounded-md border border-zinc-800 p-4">
	<h2 class="mb-1 text-xl font-semibold">Mapas sin cobertura</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Para usar una tablet como GPS en el coche: el mapa de una ruta (unos 5 km a cada lado) se guarda
		en ella y sigue viéndose sin cobertura. Se pide desde cualquier dispositivo; lo baja él la
		próxima vez que se abra la app allí.
	</p>

	<div class="mb-5 rounded-md bg-zinc-900 p-3 text-sm">
		{#if !mounted}
			…
		{:else if !routeMaps.supported}
			<p class="text-zinc-400">Este navegador no puede guardar mapas.</p>
		{:else if here}
			<p>
				Este dispositivo: <b>{here.name}</b>, guarda mapas.
				{#if routeMaps.current}
					<span class="text-amber-300">
						Bajando {routes.find((r) => r.id === routeMaps.current?.routeId)?.name ?? ''}: {Math.round(
							routeMaps.current.progress * 100
						)} %
					</span>
				{/if}
			</p>
			{#if routeMaps.persisted === false && routeMaps.held.length}
				<p class="mt-1 text-xs text-zinc-400">
					El navegador puede borrarlos si se queda sin espacio. Para que no: instala la app en la
					pantalla de inicio (menú del navegador, «Añadir a pantalla de inicio»).
				</p>
			{/if}
		{:else}
			<form class="flex flex-wrap items-center gap-2" onsubmit={register}>
				<label for="map-device" class="text-zinc-300">¿Guardar mapas en este dispositivo?</label>
				<input
					id="map-device"
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
			Todavía no hay ningún dispositivo que guarde mapas: ábrelo en la tablet y dale un nombre.
		</p>
	{:else if !routes.length}
		<p class="text-sm text-zinc-500">Guarda primero una ruta, arriba.</p>
	{:else}
		<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
			{#each routes as r (r.id)}
				{@const maps = view.maps.filter((m) => m.routeId === r.id)}
				{@const free = view.devices.filter((d) => !maps.some((m) => m.deviceId === d.id))}
				<li class="flex flex-col gap-2 p-3">
					<div class="flex flex-wrap items-center gap-2">
						<span class="mr-auto font-medium">{r.name}</span>
						{#if free.length}
							<form
								method="post"
								action="?/mapDownload"
								use:enhance={ordered}
								class="flex items-center gap-2"
							>
								<input type="hidden" name="route" value={r.id} />
								<select
									name="device"
									class={select}
									aria-label="Dispositivo para {r.name}"
									value={chosen[r.id] ?? (free.find((d) => d.id === here?.id) ?? free[0]!).id}
									onchange={(e) => (chosen[r.id] = e.currentTarget.value)}
								>
									{#each free as d (d.id)}
										<option value={d.id}>{d.name}</option>
									{/each}
								</select>
								<button
									class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
									>Bajar</button
								>
							</form>
						{/if}
					</div>
					{#each maps as m (m.deviceId)}
						{@const local = m.deviceId === here?.id && routeMaps.current?.routeId === r.id}
						<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
							<span class="text-zinc-300">{deviceName(m.deviceId)}</span>
							<span
								class={[
									'rounded-full px-2 py-0.5 text-xs',
									m.state === 'ready' && !m.old && 'bg-emerald-900 text-emerald-200',
									m.state === 'ready' && m.old && 'bg-amber-900 text-amber-200',
									(m.state === 'pending' || m.state === 'downloading') && 'bg-sky-900 text-sky-200',
									m.state === 'failed' && 'bg-red-950 text-red-300',
									m.state === 'remove' && 'bg-zinc-800 text-zinc-300'
								]}
							>
								{#if local}
									bajando {Math.round((routeMaps.current?.progress ?? 0) * 100)} %
								{:else if m.state === 'downloading'}
									bajando {Math.round(m.progress * 100)} %
								{:else if m.state === 'ready' && m.old}
									mapa antiguo
								{:else}
									{STATE[m.state]}
								{/if}
							</span>
							<span class="text-zinc-500">
								{#if m.state === 'ready'}
									{m.bytes ? sizeText(m.bytes) : ''} · {day.format(m.updatedAt)}
								{:else if m.state === 'failed'}
									{m.problem}
								{:else if m.state === 'pending'}
									se baja cuando se abra la app allí
								{:else if m.state === 'remove'}
									cuando se abra la app allí
								{/if}
							</span>
							<span class="ml-auto flex gap-3">
								{#if m.old || m.state === 'failed'}
									<form method="post" action="?/mapDownload" use:enhance={ordered}>
										<input type="hidden" name="route" value={r.id} />
										<input type="hidden" name="device" value={m.deviceId} />
										<button class={small}>Volver a bajar</button>
									</form>
								{/if}
								{#if m.state !== 'remove'}
									<form method="post" action="?/mapRemove" use:enhance={ordered}>
										<input type="hidden" name="route" value={r.id} />
										<input type="hidden" name="device" value={m.deviceId} />
										<button class={small}>Quitar</button>
									</form>
								{/if}
							</span>
						</div>
					{/each}
				</li>
			{/each}
		</ul>
	{/if}

	{#if view.devices.length}
		<h3 class="mt-5 mb-2 text-sm text-zinc-400">Dispositivos que guardan mapas</h3>
		<ul class="flex flex-col gap-1 text-sm">
			{#each view.devices as d (d.id)}
				<li class="flex flex-wrap items-center gap-x-3">
					<span>{d.name}{d.id === here?.id ? ' (este)' : ''}</span>
					<span class="text-zinc-500">abierto por última vez el {day.format(d.lastSeenAt)}</span>
					<form method="post" action="?/mapForget" use:enhance={ordered} class="ml-auto">
						<input type="hidden" name="device" value={d.id} />
						{#if forgetting === d.id}
							<button class="text-sm text-red-400">Sí, olvidarlo</button>
							<button type="button" class="ml-2 text-sm" onclick={() => (forgetting = null)}
								>No</button
							>
						{:else}
							<button
								type="button"
								class="text-sm text-zinc-500 hover:text-red-400"
								onclick={() => (forgetting = d.id)}>Olvidar</button
							>
						{/if}
					</form>
				</li>
			{/each}
		</ul>
		<p class="mt-1 text-xs text-zinc-500">
			Olvidado, sus mapas se borran de él la próxima vez que se abra la app allí.
		</p>
	{/if}
</section>
