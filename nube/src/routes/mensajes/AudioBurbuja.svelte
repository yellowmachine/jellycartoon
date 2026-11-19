<script lang="ts">
	import type { MessagesClient } from '#lib/mensajes/client.svelte.ts';
	import type { StoredMessage } from '#lib/mensajes/messenger.ts';
	import MediaIcon from 'comun/components/MediaIcon.svelte';

	/** Mensajes (#551): a voice note, decrypted here when touched, and played. */
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
