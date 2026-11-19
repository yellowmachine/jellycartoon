<script lang="ts">
	import type { MessagesClient } from '#lib/mensajes/client.svelte.ts';
	import { PIN } from '#lib/mensajes/backup.ts';

	/**
	 * Mensajes (#551): the backup behind the PIN. Without one, asked for; with one this device does not
	 * keep, brought back here; kept, said so. The PIN never leaves the device: only blinded.
	 */
	let { client }: { client: MessagesClient } = $props();

	let pin = $state('');
	let again = $state('');
	let busy = $state(false);
	let forgetting = $state(false);
	let said = $state<string | null>(null);

	const b = $derived(client.backup);
	const field =
		'w-40 rounded-md border-zinc-700 bg-zinc-900 font-mono tracking-widest [-webkit-text-security:disc]';
	const button =
		'rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50';

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (pin !== again) {
			said = 'Los dos PIN no coinciden';
			return;
		}
		busy = true;
		said = null;
		if (await client.setPin(pin, Boolean(b?.backup))) said = '✓ Copia guardada';
		pin = again = '';
		busy = false;
	}

	async function restore(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		said = null;
		const n = await client.restore(pin);
		if (n !== null) said = `✓ Recuperados ${n} ${n === 1 ? 'mensaje' : 'mensajes'}`;
		pin = '';
		busy = false;
	}

	const when = (iso: string) =>
		new Date(iso).toLocaleString('es-ES', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
</script>

{#if b}
	{#if b.backup && !b.here && !client.skipped}
		<form class="mb-4 rounded-md border border-sky-500/40 bg-sky-500/10 p-4" onsubmit={restore}>
			<h2 class="mb-1 font-semibold">Recupera tus mensajes de antes</h2>
			<p class="mb-3 text-sm text-zinc-300">
				Tienes copia de seguridad. Escribe tu PIN para traer aquí lo que se dijo antes de activar
				este aparato. Te quedan {b.triesLeft} intentos: después la copia se borra.
			</p>
			<div class="flex flex-wrap items-center gap-2">
				<input
					bind:value={pin}
					inputmode="numeric"
					autocomplete="off"
					maxlength="12"
					aria-label="Tu PIN"
					class={field}
				/>
				<button class={button} disabled={busy || !PIN.test(pin)}
					>{busy ? 'Abriendo…' : 'Recuperar'}</button
				>
				<button
					type="button"
					class="text-sm text-zinc-400 hover:text-white"
					onclick={() => (client.skipped = true)}>Ahora no</button
				>
			</div>
			<p class="mt-3 text-xs text-zinc-400">
				{#if forgetting}
					¿Seguro? La copia se borra y pones un PIN nuevo con lo que tiene este aparato.
					<button
						type="button"
						class="text-red-400 underline"
						onclick={() => void client.forgetPin()}>Sí, borrar la copia</button
					>
				{:else}
					<button
						type="button"
						class="underline hover:text-white"
						onclick={() => (forgetting = true)}>He olvidado el PIN</button
					>
				{/if}
			</p>
		</form>
	{:else if !b.backup}
		<form class="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-4" onsubmit={create}>
			<h2 class="mb-1 font-semibold">Pon un PIN para tener copia de tus mensajes</h2>
			<p class="mb-3 text-sm text-zinc-300">
				Con él, un aparato nuevo recupera lo que se dijo antes. De 6 cifras o más, que no uses en
				otro sitio. Ni Seilide puede leer la copia; sin el PIN, nadie la recupera.
			</p>
			<div class="flex flex-wrap items-center gap-2">
				<input
					bind:value={pin}
					inputmode="numeric"
					autocomplete="off"
					maxlength="12"
					aria-label="PIN nuevo"
					placeholder="PIN"
					class={field}
				/>
				<input
					bind:value={again}
					inputmode="numeric"
					autocomplete="off"
					maxlength="12"
					aria-label="Repite el PIN"
					placeholder="Repítelo"
					class={field}
				/>
				<button class={button} disabled={busy || !PIN.test(pin) || !again}
					>{busy ? 'Guardando…' : 'Guardar'}</button
				>
			</div>
		</form>
	{:else if b.here}
		<p class="mb-3 text-xs text-zinc-500">
			🔐 Copia de seguridad al día{b.updatedAt ? ` · ${when(b.updatedAt)}` : ''}
		</p>
	{/if}
	{#if said}
		<p
			class={['mb-3 text-sm', said.startsWith('✓') ? 'text-emerald-400' : 'text-red-400']}
			role="status"
		>
			{said}
		</p>
	{/if}
{/if}
