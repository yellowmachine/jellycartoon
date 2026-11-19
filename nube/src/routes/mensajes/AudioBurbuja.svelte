<script lang="ts">
	import type { MessagesClient } from '#lib/mensajes/client.svelte.ts';
	import type { StoredMessage } from '#lib/mensajes/messenger.ts';
	import MediaIcon from 'comun/components/MediaIcon.svelte';
	import { modelHere, transcriber } from '#lib/mensajes/transcriber.svelte.ts';

	/**
	 * Mensajes (#551): a voice note, decrypted here when touched, and played; and its text, made in
	 * this device when asked (the first time, its model downloaded: said before).
	 */
	let { m, client }: { m: StoredMessage; client: MessagesClient } = $props();

	let audio = $state<HTMLAudioElement>();
	let playing = $state(false);
	let loading = $state(false);
	let failed = $state(false);
	let at = $state(0);

	async function toggle() {
		if (!audio) return;
		if (playing) return audio.pause();
		if (!audio.src) {
			loading = true;
			try {
				audio.src = await client.sound(m);
			} catch {
				failed = true;
				return;
			} finally {
				loading = false;
			}
		}
		await audio.play().catch(() => (failed = true));
	}
	/** Asked once: the model is downloaded the first time, so it is said before. */
	let asking = $state(false);
	let writing = $state(false);
	let wrong = $state<string | null>(null);

	async function transcribe() {
		wrong = null;
		if (!asking && !(await modelHere())) {
			asking = true;
			return;
		}
		asking = false;
		writing = true;
		try {
			await client.transcribe(m);
		} catch (err) {
			wrong = err instanceof Error ? err.message : String(err);
		} finally {
			writing = false;
		}
	}

	const clock = (s: number) =>
		`${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
</script>

<span class="flex items-center gap-2">
	<button
		class={[
			'flex h-8 w-8 items-center justify-center rounded-full',
			m.mine ? 'bg-zinc-950/20' : 'bg-zinc-700'
		]}
		aria-label={playing ? 'Pausa' : 'Escuchar'}
		onclick={toggle}
		disabled={loading}><MediaIcon name={playing ? 'pause' : 'play'} class="h-4 w-4" /></button
	>
	<span class="font-mono text-sm tabular-nums"
		>{failed
			? 'No se puede oír'
			: loading
				? '…'
				: clock(playing || at ? at : (m.audio?.seconds ?? 0))}</span
	>
	<audio
		bind:this={audio}
		onplay={() => (playing = true)}
		onpause={() => (playing = false)}
		onended={() => ((playing = false), (at = 0))}
		ontimeupdate={(e) => (at = e.currentTarget.currentTime)}
	></audio>
</span>
<span class="mt-1 block text-sm">
	{#if m.transcript !== undefined}
		<span class="block italic opacity-90">«{m.transcript || '…'}»</span>
	{:else if writing}
		<span class="block opacity-80" role="status"
			>{transcriber.downloading !== null
				? `Bajando el modelo… ${transcriber.downloading} %`
				: 'Escribiendo lo que dice…'}</span
		>
	{:else if asking}
		<span class="block opacity-90"
			>La primera vez se bajan unos 240 MB a este aparato (mejor con wifi); luego, al momento y sin
			que el audio salga de aquí.</span
		>
		<button class="underline" onclick={transcribe}>Sí, transcribir</button>
		<button class="ml-2 opacity-70" onclick={() => (asking = false)}>Ahora no</button>
	{:else}
		<button class="opacity-80 hover:underline" onclick={transcribe}>Aa Transcribir</button>
	{/if}
	{#if wrong}<span class="block text-red-300">No se ha podido: {wrong}</span>{/if}
</span>
