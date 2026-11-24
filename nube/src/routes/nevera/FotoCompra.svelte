<script lang="ts">
	import { MAX_PHOTO_NOTE, type FridgeItem } from 'comun/fridge.ts';
	import { shrinkPhoto } from '#lib/mensajes/photo.ts';

	/**
	 * The photo of something on the shopping list, big, with its note; or to take it. A <dialog>, so
	 * it is over everything (the list's paper is turned, and would turn it too).
	 */
	let { item, onclose }: { item: FridgeItem; onclose: () => void } = $props();

	/** Enough to read a label, and light on a phone in the shop. */
	const MAX_SIDE = 1200;

	let busy = $state(false);
	let problem = $state<string | null>(null);
	let removing = $state(false);
	let note = $derived(item.photo?.note ?? '');

	async function sent(request: Promise<Response>) {
		busy = true;
		problem = null;
		try {
			const res = await request;
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				problem = body?.message ?? 'No se pudo guardar. Prueba otra vez.';
			}
			return res.ok;
		} catch {
			problem = 'No hay conexión. Prueba otra vez.';
			return false;
		} finally {
			busy = false;
		}
	}

	const act = (body: Record<string, unknown>) =>
		sent(
			fetch('/api/nevera', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: item.id, ...body })
			})
		);

	async function picked(input: HTMLInputElement) {
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		busy = true;
		problem = null;
		let blob: Blob;
		try {
			({ blob } = await shrinkPhoto(file, MAX_SIDE));
		} catch (err) {
			problem = (err as Error).message;
			busy = false;
			return;
		}
		await sent(
			fetch(`/api/nevera/foto?id=${item.id}`, {
				method: 'POST',
				headers: { 'content-type': 'image/jpeg' },
				body: blob
			})
		);
	}

	async function remove() {
		removing = false;
		await act({ action: 'photoRemove' });
	}
</script>

{#snippet pick(text: string, camera: boolean)}
	<label
		class={[
			'cursor-pointer rounded-md px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-amber-300',
			item.photo
				? 'bg-zinc-800 hover:bg-zinc-700'
				: 'bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400',
			busy && 'pointer-events-none opacity-50'
		]}
	>
		{text}
		<input
			type="file"
			accept="image/*"
			capture={camera ? 'environment' : undefined}
			class="sr-only"
			disabled={busy}
			onchange={(e) => picked(e.currentTarget)}
		/>
	</label>
{/snippet}

<dialog
	{@attach (el) => el.showModal()}
	{onclose}
	onclick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
	aria-label="Foto de {item.text}"
	class="m-auto max-h-[95dvh] w-[min(36rem,95vw)] rounded-xl bg-zinc-900 p-0 text-zinc-100 backdrop:bg-black/80"
>
	<div class="flex flex-col gap-3 p-4">
		<div class="flex items-center justify-between gap-3">
			<h2 class="min-w-0 text-lg font-semibold break-words">{item.text}</h2>
			<form method="dialog">
				<button class="rounded-full bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700"
					>✕ Cerrar</button
				>
			</form>
		</div>
		{#if item.photo}
			<img
				src={item.photo.url}
				alt={item.photo.note || item.text}
				class="max-h-[60dvh] w-full rounded-md object-contain"
			/>
			<form
				class="flex gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					void act({ action: 'photoNote', note });
				}}
			>
				<input
					bind:value={note}
					maxlength={MAX_PHOTO_NOTE}
					placeholder="Nota: el de tapa azul, sin alcohol…"
					aria-label="Nota de la foto"
					class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500"
				/>
				<button
					class="rounded-md bg-amber-500 px-3 text-sm font-medium text-zinc-950 disabled:opacity-40"
					disabled={busy || note.trim() === item.photo.note}>Guardar</button
				>
			</form>
		{:else}
			<p class="text-sm text-zinc-400">
				Hazle una foto al que tenéis, para ver cuál es al comprar. La próxima vez que lo apuntéis,
				sale con su foto.
			</p>
		{/if}
		{#if problem}
			<p class="text-sm text-red-400" role="alert">{problem}</p>
		{/if}
		<div class="flex flex-wrap items-center gap-2">
			{#if removing}
				<span class="text-sm text-zinc-400">¿Quitar la foto?</span>
				<button
					class="rounded-md px-3 py-2 text-sm text-red-400 hover:bg-zinc-800"
					disabled={busy}
					onclick={remove}>Sí, quitarla</button
				>
				<button
					class="rounded-md px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
					onclick={() => (removing = false)}>No</button
				>
			{:else}
				{@render pick('📷 Hacer foto', true)}
				{@render pick('🖼️ Elegir una', false)}
				{#if item.photo}
					<button
						class="rounded-md px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
						disabled={busy}
						onclick={() => (removing = true)}>Quitar la foto</button
					>
				{/if}
			{/if}
			{#if busy}
				<span class="text-sm text-zinc-400" role="status">Guardando…</span>
			{/if}
		</div>
	</div>
</dialog>
