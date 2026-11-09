<script lang="ts">
	import { onMount } from 'svelte';
	import { afterNavigate, goto, invalidateAll, pushState } from '$app/navigation';
	import { page } from '$app/state';
	import MusicBar from 'comun/components/MusicBar.svelte';
	import TvDebug from '#lib/components/TvDebug.svelte';
	import TvSalonFailed from '#lib/components/TvSalonFailed.svelte';
	import TvSnake from '#lib/components/TvSnake.svelte';
	import TvVoice from '#lib/components/TvVoice.svelte';
	import { music } from 'comun/music-player.svelte.ts';
	import { CODE } from '#lib/snake.ts';
	import { stillThere } from '#lib/still-there.svelte.ts';
	import { watchSalon } from '#lib/salon.svelte.ts';
	import { videoHere } from '#lib/video-here.svelte.ts';
	import { tvShortcutWindow } from '#lib/tv-shortcut.svelte.ts';
	import { voice } from '#lib/voice-client.svelte.ts';
	import { moveFocus, watchGamepad, type Press } from '#lib/tv-gamepad.ts';

	let { children } = $props();
	let main = $state<HTMLElement>();
	const salon = watchSalon();

	/**
	 * The remote's keys that Chromium does not get as they are, remapped by udev (the docs'
	 * «Mando del salón»): F7 its Home, F8 its Play/Pause, F9 its microphone. Its OK is Enter and its
	 * Back the browser's, which need nothing here.
	 */
	/** The last digits typed on the remote's number pad, which does nothing else here. */
	let digits = '';

	function remoteKey(e: KeyboardEvent) {
		// Someone with the remote: for «¿Sigues ahí?» and /infantil's «Última interacción».
		stillThere.someoneThere();
		// 6 1 1 0, the Nokia that made the snake famous: the hidden game, as a step in the history so
		// the remote's Back closes it.
		if (/^\d$/.test(e.key)) {
			digits = (digits + e.key).slice(-CODE.length);
			if (digits === CODE && !page.state.snake) {
				digits = '';
				pushState('', { snake: true });
			}
			return;
		}
		if (e.key === 'F7') {
			e.preventDefault();
			void goto('/tv');
		} else if (e.key === 'F8') {
			e.preventDefault();
			// What is on: the living room's mpv first, then what sounds in this browser.
			const mpv = salon.state;
			if (mpv?.active) void salon.send({ action: 'pause', value: !mpv.paused });
			else if (music.radio || music.podcast || music.current) music.toggle();
			else videoHere.toggle();
		} else if (e.key === 'F9' && page.data.voice) {
			e.preventDefault();
			// The remote sends its microphone key pressed and let go at once: a tap to start, another
			// to send, whatever this device's setting is.
			if (!e.repeat) voice.toggle();
		}
	}

	/**
	 * The gamepad as the remote (#176), but in a game, where the emulator has it: the cross moves,
	 * A is OK, B is Back, Start is Home and Select the microphone. The snake plays with keys: there
	 * it is the keyboard's arrows, Enter and Escape.
	 */
	$effect(() => {
		if (page.route.id?.endsWith('/jugar')) return;
		return watchGamepad(gamepadPress);
	});

	const SNAKE_KEYS: Partial<Record<Press, string>> = {
		up: 'ArrowUp',
		down: 'ArrowDown',
		left: 'ArrowLeft',
		right: 'ArrowRight',
		ok: 'Enter',
		back: 'Escape'
	};

	function gamepadPress(what: Press) {
		stillThere.someoneThere();
		if (page.state.snake) {
			const key = SNAKE_KEYS[what];
			if (key) dispatchEvent(new KeyboardEvent('keydown', { key }));
		} else if (what === 'ok') (document.activeElement as HTMLElement | null)?.click();
		else if (what === 'back') history.back();
		else if (what === 'home') void goto('/tv');
		else if (what === 'mic') {
			if (page.data.voice) voice.toggle();
		} else moveFocus(what);
	}

	/**
	 * What gets the focus, in the middle of the screen. Chromium's spatial navigation only moves to
	 * what is in view: with the next row below the screen, an arrow press scrolled the page and
	 * only the next one moved the focus.
	 */
	function centerFocus(e: FocusEvent) {
		if (e.target instanceof HTMLElement && main?.contains(e.target))
			e.target.scrollIntoView({ block: 'center' });
	}

	// The remote needs something with the focus to start from: the first tile, or the one the page
	// marks.
	afterNavigate(() =>
		(
			main?.querySelector<HTMLElement>('[data-focus]') ??
			// Not what is playing, in the header: it is reached going up.
			main?.querySelector<HTMLElement>(':is(a, button):not(header *)')
		)?.focus()
	);

	// A shortcut's window (#327) open before a reload of the TV view: its time goes on counting.
	onMount(() => tvShortcutWindow.recover());
</script>

<!-- Back from mpv (the window gets the focus again): what was watched moved on. -->
<svelte:window onfocus={() => invalidateAll()} onkeydown={remoteKey} />
<svelte:document onfocusin={centerFocus} />

<main bind:this={main} class="min-h-screen px-12 py-10 text-2xl">
	{@render children()}
</main>

{#if page.data.salon}
	<TvSalonFailed />
{/if}

{#if page.data.voice}
	<TvVoice {salon} />
{/if}

<TvDebug />

{#if page.state.snake}
	<TvSnake />
{/if}

<!-- The music sounds through its <audio>; its bar is for the whole app, not for the TV. -->
<div class="hidden"><MusicBar /></div>
