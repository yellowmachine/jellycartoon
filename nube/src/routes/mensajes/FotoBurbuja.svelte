<script lang="ts">
	import type { MessagesClient } from '#lib/mensajes/client.svelte.ts';
	import type { StoredMessage } from '#lib/mensajes/messenger.ts';

	/**
	 * Mensajes (#555): a photo, downloaded and decrypted here when it is shown; touched, as big as the
	 * screen.
	 */
	let { m, client }: { m: StoredMessage; client: MessagesClient } = $props();

	let url = $state<string | null>(null);
	let failed = $state(false);
	let big = $state(false);

	$effect(() => {
		let gone = false;
		client
			.picture(m)
			.then((u) => !gone && (url = u))
			.catch(() => !gone && (failed = true));
		return () => (gone = true);
	});

	const ratio = $derived(m.photo ? `${m.photo.width} / ${m.photo.height}` : '1');
</script>

{#if failed}
	<span class="block text-sm opacity-80">📷 No se puede ver la foto</span>
{:else}
	<button
		class="block w-64 max-w-full overflow-hidden rounded-xl bg-zinc-950/30"
		style:aspect-ratio={ratio}
		aria-label="Ver la foto en grande"
		onclick={() => (big = true)}
		disabled={!url}
	>
		{#if url}
			<img src={url} alt="Foto" class="h-full w-full object-cover" />
		{:else}
			<span class="flex h-full items-center justify-center text-sm opacity-70" role="status"
				>📷 …</span
			>
		{/if}
	</button>
{/if}

{#if big && url}
	<div
		class="tema-oscuro fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-2"
		role="dialog"
		aria-modal="true"
		aria-label="Foto"
	>
		<img src={url} alt="Foto" class="max-h-full max-w-full object-contain" />
		<button
			class="absolute top-3 right-3 rounded-full bg-zinc-800 px-4 py-2 text-white"
			onclick={() => (big = false)}>✕ Cerrar</button
		>
		<a
			class="absolute right-3 bottom-3 rounded-full bg-zinc-800 px-4 py-2 text-white"
			href={url}
			download="foto.jpg">Guardar</a
		>
	</div>
{/if}

<svelte:window onkeydown={(e) => big && e.key === 'Escape' && (big = false)} />
