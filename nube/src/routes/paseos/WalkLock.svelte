<script lang="ts">
	import { onDestroy } from 'svelte';

	/**
	 * The screen kept on but black while walking (#410), as the GPS only reaches a visible page: over
	 * everything, in the browser's top layer, and only a finger held still opens it. Walking gives two
	 * knocks a second, which a double tap could take for itself. The screen stays on with the
	 * browser's Screen Wake Lock: https://developer.mozilla.org/docs/Web/API/Screen_Wake_Lock_API
	 */
	const HOLD_MS = 2000;
	/** A finger moving further than this is not being held: a rub of the pocket. */
	const STILL_PX = 30;
	const HINT_MS = 4000;
	/**
	 * It opens this long after the finger goes up, never under it: the browser's click for that touch
	 * would land on what is below, as «Terminar».
	 */
	const OPEN_AFTER_MS = 400;

	let { onlock }: { onlock?: () => void } = $props();

	let dialog = $state<HTMLDialogElement>();
	let locked = $state(false);
	let hint = $state(false);
	let holding = $state(false);
	/** Held long enough: it opens when the finger goes up. */
	let held = $state(false);
	let problem = $state<string | null>(null);

	let sentinel: WakeLockSentinel | null = null;
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let hintTimer: ReturnType<typeof setTimeout> | undefined;
	let openTimer: ReturnType<typeof setTimeout> | undefined;
	let finger: { id: number; x: number; y: number } | null = null;

	async function keepOn() {
		sentinel = await navigator.wakeLock.request('screen');
	}

	function onVisibility() {
		// The browser lets it go when the page is hidden: asked for again when it comes back.
		if (locked && !document.hidden) void keepOn().catch(() => {});
	}

	function showHint() {
		hint = true;
		clearTimeout(hintTimer);
		hintTimer = setTimeout(() => (hint = false), HINT_MS);
	}

	async function lock() {
		problem = null;
		try {
			await keepOn();
		} catch {
			problem =
				'Este móvil no deja mantener la pantalla encendida ahora: se apagaría y el GPS con ella.';
			return;
		}
		locked = true;
		onlock?.();
		dialog?.showModal();
		document.addEventListener('visibilitychange', onVisibility);
		showHint();
		// Without Android's bars, a touch at the edge does not leave the page; without it, it still works.
		void document.documentElement.requestFullscreen?.().catch(() => {});
	}

	function unlock() {
		if (!locked) return;
		locked = false;
		stopHolding();
		clearTimeout(hintTimer);
		clearTimeout(openTimer);
		document.removeEventListener('visibilitychange', onVisibility);
		void sentinel?.release().catch(() => {});
		sentinel = null;
		if (dialog?.open) dialog.close();
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
	}

	function stopHolding() {
		clearTimeout(holdTimer);
		holding = false;
		held = false;
		finger = null;
	}

	function press(e: PointerEvent) {
		if (finger) return;
		finger = { id: e.pointerId, x: e.clientX, y: e.clientY };
		holding = true;
		holdTimer = setTimeout(() => (held = true), HOLD_MS);
	}

	function move(e: PointerEvent) {
		if (
			finger?.id === e.pointerId &&
			Math.hypot(e.clientX - finger.x, e.clientY - finger.y) > STILL_PX
		)
			stopHolding();
	}

	function letGo(e: PointerEvent) {
		if (finger?.id !== e.pointerId) return;
		const open = held;
		stopHolding();
		if (open) openTimer = setTimeout(unlock, OPEN_AFTER_MS);
		else showHint();
	}

	// Only there while walking: the walk over, or another page, nothing left to keep the screen on for.
	onDestroy(unlock);
</script>

<!-- The first thing on the screen: the phone's own button stops the GPS, and nothing else says so. -->
<button
	class="w-full rounded-md bg-amber-500 px-4 py-4 text-zinc-950 hover:bg-amber-400"
	onclick={lock}
>
	<span class="block text-xl font-bold">🔒 Bloquear pantalla</span>
	<span class="block text-sm">Sigue midiendo en el bolsillo</span>
</button>
<p class="mt-2 text-sm text-amber-300">⚠ Con el botón de encendido se para el GPS</p>
{#if problem}
	<p class="mt-2 text-sm text-amber-300" role="alert">{problem}</p>
{/if}

<!-- The back gesture closes a dialog by itself: refused, or the walk is left unlocked in a pocket. -->
<dialog
	bind:this={dialog}
	aria-label="Pantalla bloqueada"
	class="lock m-0 h-dvh max-h-none w-dvw max-w-none border-0 bg-black p-0 text-zinc-500"
	oncancel={(e) => e.preventDefault()}
	onclose={unlock}
	onpointerdown={press}
	onpointermove={move}
	onpointerup={letGo}
	onpointercancel={letGo}
	oncontextmenu={(e) => e.preventDefault()}
>
	<div class="flex h-full items-center justify-center p-6 text-center select-none">
		{#if held}
			<p>Suelta</p>
		{:else if holding}
			<div class="h-1 w-40 overflow-hidden rounded bg-zinc-800" role="progressbar">
				<div class="fill h-full bg-zinc-500" style="animation-duration: {HOLD_MS}ms"></div>
			</div>
		{:else if hint}
			<p>Mantén pulsado 2 segundos para desbloquear</p>
		{/if}
	</div>
</dialog>

<style>
	.lock {
		touch-action: none;
	}
	.lock::backdrop {
		background: #000;
	}
	.fill {
		animation-name: fill;
		animation-timing-function: linear;
		animation-fill-mode: both;
	}
	@keyframes fill {
		from {
			width: 0;
		}
		to {
			width: 100%;
		}
	}
</style>
