<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { music } from '#lib/music-player.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let frame = $state<HTMLIFrameElement>();

	// The game's sound, not the music or the radio over it.
	onMount(() => music.stop());

	/**
	 * EmulatorJS in a page of its own (static/juegos/emulador.html), in a frame: leaving the game
	 * removes the frame, and the emulator and its sound go with it.
	 */
	const src = $derived(
		`/juegos/emulador.html?${new URLSearchParams({ core: data.core, rom: data.rom, title: data.title })}`
	);

	/** Its own API, as far as it is used here (its src/emulator.js and src/GameManager.js). */
	type Emulator = {
		started: boolean;
		gameManager: {
			saveSaveFiles(): void;
			FS: { syncfs(populate: boolean, done: (err: unknown) => void): void };
		};
	};

	/**
	 * The game's own save (the cartridge's) into the browser before the frame goes. EmulatorJS
	 * writes it every few minutes and when its page closes, but removing a frame does not close it
	 * that way: what was played since would be lost.
	 */
	let saved = false;
	beforeNavigate((nav) => {
		const emulator = (frame?.contentWindow as { EJS_emulator?: Emulator } | null)?.EJS_emulator;
		// Closing the tab or the browser does close its page: EmulatorJS saves by itself.
		if (saved || nav.type === 'leave' || !emulator?.started) return;
		nav.cancel();
		saved = true;
		// Back cancelled: SvelteKit puts the history where it was with a step of its own, which has
		// to end before taking ours.
		const restored =
			nav.type === 'popstate'
				? new Promise((done) =>
						addEventListener('popstate', () => setTimeout(done), { once: true })
					)
				: null;
		emulator.gameManager.saveSaveFiles();
		const flushed = new Promise((done) => {
			emulator.gameManager.FS.syncfs(false, done);
			// Never stuck in the game, saved or not.
			setTimeout(done, 2000);
		});
		void Promise.all([restored, flushed]).then(() => {
			// The same step again: Back goes back in the history rather than forward to the list.
			if (nav.type === 'popstate') history.go(nav.delta);
			else if (nav.to) void goto(nav.to.url);
		});
	});
</script>

<svelte:head>
	<title>{data.title} · JellyCartoon</title>
</svelte:head>

<!-- The whole screen, over the TV view; the remote's Back leaves the game. -->
<iframe
	bind:this={frame}
	{src}
	title={data.title}
	allow="fullscreen; gamepad; autoplay"
	class="fixed inset-0 z-50 h-full w-full border-0 bg-black"
	data-focus
></iframe>
