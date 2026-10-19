<script lang="ts">
	import { page } from '$app/state';
	import { voice } from '#lib/voice-client.svelte.ts';

	/**
	 * What the TV view gets from the remote, over the page, to find out why something does not
	 * work: the keys, where the focus goes (framed) and whether the page scrolled instead, and what
	 * the voice does. On with `?depurar` in the address, for this tab until `?depurar=no`.
	 */

	const KEY = 'jellycartoon-tv-debug';
	const MAX_LINES = 14;

	let on = $state(false);
	let lines = $state<{ id: number; at: string; text: string }[]>([]);
	let next = 0;
	let frame = $state<DOMRect | null>(null);
	let listeningSince = 0;
	let seconds = $state(0);
	let scrollY = $state(0);

	$effect(() => {
		const param = page.url.searchParams.get('depurar');
		if (param === null) return;
		on = param !== 'no';
		try {
			if (on) sessionStorage.setItem(KEY, '1');
			else sessionStorage.removeItem(KEY);
		} catch {
			// Without storage it only lasts until the next page.
		}
	});

	$effect(() => {
		try {
			if (sessionStorage.getItem(KEY)) on = true;
		} catch {
			// Off, as without the flag.
		}
	});

	function log(text: string) {
		const at = new Date().toLocaleTimeString('es-ES');
		lines = [{ id: next++, at, text }, ...lines].slice(0, MAX_LINES);
	}

	/** e.g. `button «E3 · Piloto»`. */
	function describe(el: Element | null) {
		if (!el || el === document.body) return 'nada';
		const text = (el.getAttribute('aria-label') ?? el.textContent ?? '')
			.trim()
			.replace(/\s+/g, ' ');
		return `${el.tagName.toLowerCase()}${text ? ` «${text.slice(0, 40)}»` : ''}`;
	}

	function reframe() {
		const el = document.activeElement;
		frame = el && el !== document.body ? el.getBoundingClientRect() : null;
	}

	$effect(() => {
		if (!on) return;
		let scrolled = window.scrollY;
		const key = (e: KeyboardEvent) => {
			log(`tecla ${e.key}${e.repeat ? ' (repetida)' : ''}`);
			// The layout only listens to it with voice on for this user.
			if (e.key === 'F9' && !page.data.voice) log('F9: la voz no está activada para ti');
		};
		const focus = () => {
			log(`foco → ${describe(document.activeElement)}`);
			reframe();
		};
		const scroll = () => {
			// Once per gesture: a smooth scroll fires many.
			clearTimeout(timer);
			timer = setTimeout(() => {
				const by = Math.round(window.scrollY - scrolled);
				log(`página desplazada ${by > 0 ? '+' : ''}${by} px`);
				scrolled = window.scrollY;
			}, 150);
			scrollY = window.scrollY;
			reframe();
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		// Capture: before the page's own handlers, which may stop them.
		window.addEventListener('keydown', key, true);
		window.addEventListener('focusin', focus, true);
		window.addEventListener('scroll', scroll, true);
		scrollY = window.scrollY;
		reframe();
		return () => {
			clearTimeout(timer);
			window.removeEventListener('keydown', key, true);
			window.removeEventListener('focusin', focus, true);
			window.removeEventListener('scroll', scroll, true);
		};
	});

	// The voice, step by step.
	$effect(() => {
		if (!on) return;
		const phase = voice.phase;
		log(`voz: ${{ idle: 'parada', listening: 'escuchando', thinking: 'enviando' }[phase]}`);
		if (phase !== 'listening') return;
		listeningSince = performance.now();
		seconds = 0;
		const timer = setInterval(() => (seconds = (performance.now() - listeningSince) / 1000), 250);
		return () => clearInterval(timer);
	});
	$effect(() => {
		if (on && voice.heard) log(`voz oyó: «${voice.heard}»`);
	});
	$effect(() => {
		if (on && voice.reply) log(`voz contestó: «${voice.reply}»`);
	});
	$effect(() => {
		if (on && voice.problem) log(`voz, problema: ${voice.problem}`);
	});
</script>

{#if on}
	{#if frame}
		<div
			class="pointer-events-none fixed z-50 rounded-lg border-4 border-fuchsia-500"
			style:left="{frame.left - 4}px"
			style:top="{frame.top - 4}px"
			style:width="{frame.width + 8}px"
			style:height="{frame.height + 8}px"
		></div>
	{/if}
	<div
		class="pointer-events-none fixed top-4 right-4 z-50 w-[36rem] rounded-2xl border border-fuchsia-500/60 bg-zinc-950/90 p-4 font-mono text-base text-zinc-200 shadow-2xl"
	>
		<p class="mb-2 font-semibold text-fuchsia-400">
			Depurar · {voice.phase === 'listening' ? `escuchando ${seconds.toFixed(1)} s` : 'voz parada'}
			· y={Math.round(scrollY)}
		</p>
		{#each lines as line (line.id)}
			<p class="truncate"><span class="text-zinc-500">{line.at}</span> {line.text}</p>
		{/each}
	</div>
{/if}
