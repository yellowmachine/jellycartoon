<script lang="ts">
	import { parseCoordinates } from '#lib/coordinates.ts';
	import type { LngLat, Place } from '#lib/road.ts';

	/**
	 * Where a kept place or a route's stop is (#151): searched by its name or address (the road
	 * mode's search, openrouteservice), or coordinates or a map link pasted from elsewhere. Not a
	 * form of its own: it goes inside one.
	 */
	let {
		onfound,
		placeholder = 'Busca un sitio, o pega coordenadas o un enlace del mapa'
	}: { onfound: (point: { at: LngLat; address: string | null }) => void; placeholder?: string } =
		$props();

	let text = $state('');
	let places = $state<Place[] | null>(null);
	let busy = $state(false);
	let problem = $state<string | null>(null);

	/** Pasted coordinates are taken at once, without searching. */
	const pasted = $derived(parseCoordinates(text));

	async function find() {
		problem = null;
		places = null;
		if (pasted) {
			onfound({ at: pasted, address: null });
			text = '';
			return;
		}
		const q = text.trim();
		if (!q) return;
		busy = true;
		const res = await fetch(`/carretera/buscar?${new URLSearchParams({ q })}`).catch(() => null);
		const body = await res?.json().catch(() => null);
		busy = false;
		if (!res?.ok) return void (problem = body?.message ?? 'Sin conexión');
		places = body;
	}

	function choose(place: Place) {
		onfound({ at: place.at, address: place.label });
		places = null;
		text = '';
	}
</script>

<div class="flex flex-col gap-2">
	<div class="flex gap-2">
		<input
			bind:value={text}
			type="search"
			autocomplete="off"
			{placeholder}
			aria-label="Buscar o pegar coordenadas"
			class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm"
			onkeydown={(e) => {
				if (e.key !== 'Enter') return;
				// Enter here finds the point; it does not send the form around it.
				e.preventDefault();
				void find();
			}}
		/>
		<button
			type="button"
			class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900 disabled:opacity-50"
			disabled={busy || !text.trim()}
			onclick={find}>{busy ? 'Buscando…' : pasted ? 'Usar estas coordenadas' : 'Buscar'}</button
		>
	</div>
	{#if pasted}
		<p class="text-xs text-zinc-400">
			Coordenadas: {pasted[1].toFixed(5)}, {pasted[0].toFixed(5)}
		</p>
	{/if}
	{#if problem}
		<p class="text-sm text-red-300">{problem}</p>
	{/if}
	{#if places}
		<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
			{#each places as place (place.label)}
				<li>
					<button
						type="button"
						class="w-full px-3 py-2 text-left text-sm hover:bg-zinc-900"
						onclick={() => choose(place)}>{place.label}</button
					>
				</li>
			{:else}
				<li class="px-3 py-2 text-sm text-zinc-400">No he encontrado ese sitio.</li>
			{/each}
		</ul>
	{/if}
</div>
