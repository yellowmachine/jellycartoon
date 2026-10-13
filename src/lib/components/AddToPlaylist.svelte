<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import ActionMenu from './ActionMenu.svelte';
	import { menuItem } from './menu.ts';

	interface Props {
		trackId: number;
		/** Unique on the page, with the track: the same track can be shown twice. */
		key: string;
		playlists: { id: number; name: string }[];
	}

	let { trackId, key, playlists }: Props = $props();

	/** Shown on the button for a moment after adding. */
	let added = $state(false);
	let creating = $state(false);
	let error = $state<string | null>(null);

	async function add(body: { playlistId: number } | { name: string }, close: () => void) {
		error = null;
		const res = await fetch('/api/music/playlists', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ trackId, ...body })
		}).catch(() => null);
		if (!res?.ok) {
			error = (await res?.json().catch(() => null))?.message ?? 'Sin conexión';
			return;
		}
		close();
		creating = false;
		added = true;
		setTimeout(() => (added = false), 1500);
		// A new playlist shows up in every «+», and the counts of the playlists page change.
		if ('name' in body) await invalidateAll();
	}
</script>

<ActionMenu id="add-{key}" plain label="Añadir a una lista">
	{#snippet icon()}
		<span class="text-lg leading-none" class:text-amber-400={added}>{added ? '✓' : '+'}</span>
	{/snippet}
	{#snippet children(close)}
		<p class="px-3 pt-1 pb-0.5 text-xs text-zinc-500">Añadir a</p>
		{#each playlists as playlist (playlist.id)}
			<button class={menuItem} onclick={() => add({ playlistId: playlist.id }, close)}>
				<span class="block truncate">{playlist.name}</span>
			</button>
		{/each}
		{#if creating}
			<form
				class="flex gap-1 px-1 py-1"
				onsubmit={(e) => {
					e.preventDefault();
					const name = String(new FormData(e.currentTarget).get('name') ?? '');
					void add({ name }, close);
				}}
			>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					name="name"
					placeholder="Nombre de la lista"
					aria-label="Nombre de la lista nueva"
					autofocus
					class="min-w-0 flex-1 rounded border-zinc-700 bg-zinc-950 py-1 text-sm"
				/>
				<button class="rounded bg-amber-500 px-2 text-sm font-medium text-zinc-950">Crear</button>
			</form>
		{:else}
			<button class="{menuItem} text-amber-400" onclick={() => (creating = true)}>
				Nueva lista…
			</button>
		{/if}
		{#if error}
			<p class="px-3 py-1 text-xs text-red-400">{error}</p>
		{/if}
	{/snippet}
</ActionMenu>
