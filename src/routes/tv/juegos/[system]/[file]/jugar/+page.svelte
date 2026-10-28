<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { beforeNavigate, goto, pushState } from '$app/navigation';
	import { page } from '$app/state';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { SHADERS, shaderName, type Shader } from '#lib/game-shaders.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let frame = $state<HTMLIFrameElement>();
	let menuBox = $state<HTMLElement>();

	// The game's sound, not the music or the radio over it.
	onMount(() => music.stop());

	/**
	 * Opened from one of the saved games on the game's page (`?partida=`): that moment, once the
	 * emulator has started.
	 */
	onMount(() => {
		const saveId = Number(page.url.searchParams.get('partida'));
		if (!saveId) return;
		let tries = 0;
		const timer = setInterval(() => {
			const running = emulator();
			if (!running && ++tries < 120) return;
			clearInterval(timer);
			// After the person's cartridge: the game restarts with it.
			if (running) void player()!.cartridgeReady!.then(() => loadSave(running, saveId));
		}, 250);
		return () => clearInterval(timer);
	});

	/** A saved game into the emulator: its state, gzipped on the server as it was saved. */
	async function loadState(running: Emulator, saveId: number) {
		const res = await fetch(`/api/juegos/partida/${saveId}/estado`);
		if (!res.ok || !res.body) throw new Error(await res.text());
		const state = res.body.pipeThrough(new DecompressionStream('gzip'));
		running.gameManager.loadState(new Uint8Array(await new Response(state).arrayBuffer()));
	}

	async function loadSave(running: Emulator, saveId: number) {
		try {
			await loadState(running, saveId);
			running.displayMessage('Partida cargada', 3000);
		} catch {
			running.displayMessage('No se pudo cargar la partida', 3000);
		}
	}

	/**
	 * EmulatorJS in a page of its own (static/juegos/emulador.html), in a frame: leaving the game
	 * removes the frame, and the emulator and its sound go with it.
	 */
	const src = $derived(
		`/juegos/emulador.html?${new URLSearchParams({
			core: data.core,
			rom: data.rom,
			title: data.title,
			backdrop: data.backdrop,
			cartridge: data.cartridge,
			controls: JSON.stringify(data.controls),
			shader: data.shader.own ?? data.shader.inherited,
			...(data.bios ? { bios: data.bios } : {})
		})}`
	);

	/** Its own API, as far as it is used here (its src/emulator.js and src/GameManager.js). */
	type Emulator = {
		started: boolean;
		paused: boolean;
		pause(): void;
		play(): void;
		displayMessage(text: string, ms: number): void;
		changeSettingOption(option: 'shader', value: Shader): void;
		gameManager: {
			saveSaveFiles(): void;
			getState(): Uint8Array;
			loadState(state: Uint8Array): void;
			restart(): void;
			FS: { syncfs(populate: boolean, done: (err: unknown) => void): void };
		};
	};
	type Player = {
		EJS_emulator?: Emulator;
		picture?: (emulator: Emulator) => Promise<Blob>;
		cartridgeReady?: Promise<void>;
		saveCartridge?: () => Promise<void>;
	};
	const player = () => frame?.contentWindow as Player | null | undefined;
	const emulator = () => (player()?.EJS_emulator?.started ? player()!.EJS_emulator! : null);

	/**
	 * How long it is played (#176): a session from the emulator starting, and the seconds really
	 * played (not paused, nor in the menu, nor with the screen hidden), told every half minute and
	 * when leaving. Without «Guardar historial», no session and nothing told.
	 */
	let sessionId: number | null = null;
	let unreported = 0;
	function report(leaving = false) {
		if (!sessionId || !unreported) return;
		const url = `/api/juegos/sesiones/${sessionId}`;
		const body = JSON.stringify({ seconds: unreported });
		unreported = 0;
		// Leaving, the page may be gone before a fetch ends: the browser sends a beacon all the same.
		if (leaving) navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
		else
			void fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body
			}).catch(() => {});
	}
	onMount(() => {
		let started = false;
		let ticks = 0;
		const timer = setInterval(async () => {
			const running = emulator();
			if (!running) return;
			if (!started) {
				started = true;
				const res = await fetch('/api/juegos/sesiones', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ gameId: data.gameId })
				}).catch(() => null);
				sessionId = res?.ok ? (await res.json()).id : null;
				return;
			}
			if (!running.paused && !menu && document.visibilityState === 'visible') unreported++;
			if (++ticks % 30 === 0) report();
		}, 1000);
		const leave = () => report(true);
		addEventListener('pagehide', leave);
		return () => {
			clearInterval(timer);
			removeEventListener('pagehide', leave);
			report(true);
		};
	});

	/**
	 * The game's own save (the cartridge's) into the browser and to the server before the frame
	 * goes. EmulatorJS writes it every minute and when its page closes, but removing a frame does
	 * not close it that way: what was played since would be lost.
	 */
	let saved = false;
	beforeNavigate((nav) => {
		const running = emulator();
		// Closing the tab or the browser does close its page: EmulatorJS saves by itself.
		if (saved || nav.type === 'leave' || !running) return;
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
		const sent = player()?.saveCartridge?.();
		const flushed = new Promise((done) => {
			const synced = new Promise((ok) => running.gameManager.FS.syncfs(false, ok));
			void Promise.all([synced, sent]).then(done);
			// Never stuck in the game, saved or not.
			setTimeout(done, 3000);
		});
		void Promise.all([restored, flushed]).then(() => {
			// The same step again: Back goes back in the history rather than forward to the list.
			if (nav.type === 'popstate') history.go(nav.delta);
			else if (nav.to) void goto(nav.to.url);
		});
	});

	/**
	 * The game's own menu (#176), opened with the remote's OK or Select + Start on the gamepad
	 * (emulador.html tells this page): the game paused under it. A step in the history, as the
	 * snake's, so the remote's Back closes it; the saved games, one more. Kept here rather than in
	 * page.state: the TV layout reloads the page's data when the window gets the focus back (from
	 * the frame, here), and that empties page.state.
	 */
	let menu = $state<'menu' | 'partidas' | 'imagen' | null>(null);
	/**
	 * The picture of the moment it was paused at, for «Guardar partida»: taken before pausing, as a
	 * paused emulator draws nothing and the browser has no picture of it to give.
	 */
	let shot: Blob | null = null;
	let opening = false;
	/** The popstate of steps taken here, already acted on. */
	let skipBack = false;
	$effect(() => {
		const open = async () => {
			const running = emulator();
			const picture = player()?.picture;
			if (menu || opening || !running) return;
			opening = true;
			shot = picture
				? await Promise.race([
						picture(running),
						new Promise<null>((done) => setTimeout(() => done(null), 1500))
					]).catch(() => null)
				: null;
			opening = false;
			pushState('', { gameMenu: 'menu' });
			menu = 'menu';
		};
		// Back: one step less. Several at once (history.go) are one popstate: those, done already.
		const back = () => {
			if (skipBack) skipBack = false;
			else if (menu === 'partidas') menu = 'menu';
			else if (menu === 'imagen') {
				preview(shader);
				menu = 'menu';
			} else menu = null;
		};
		addEventListener('juegos:menu', open);
		addEventListener('popstate', back);
		return () => {
			removeEventListener('juegos:menu', open);
			removeEventListener('popstate', back);
		};
	});

	let wasOpen = false;
	$effect(() => {
		const open = Boolean(menu);
		if (open !== wasOpen) {
			wasOpen = open;
			if (open) emulator()?.pause();
			else {
				message = '';
				emulator()?.play();
				frame?.focus();
			}
		}
		// The one in use, if the menu has one (the shaders'); else the first.
		if (menu)
			void tick().then(() =>
				(
					menuBox?.querySelector<HTMLElement>('[aria-current="true"]') ??
					menuBox?.querySelector<HTMLElement>('button')
				)?.focus()
			);
	});

	/** What the menu says while it does something, or what went wrong. */
	let message = $state('');
	let busy = $state(false);

	/** Back to the game: the menu's steps out of the history, and the menu closed now. */
	function close() {
		const steps = menu === 'partidas' || menu === 'imagen' ? 2 : 1;
		skipBack = true;
		menu = null;
		history.go(-steps);
	}

	async function save() {
		const running = emulator();
		if (!running || busy) return;
		busy = true;
		message = 'Guardando…';
		try {
			const form = new FormData();
			// Compressed: a Super Nintendo's state is some 800 KB, and a tenth of it in gzip.
			const state = new Blob([running.gameManager.getState() as Uint8Array<ArrayBuffer>]);
			form.append(
				'estado',
				await new Response(state.stream().pipeThrough(new CompressionStream('gzip'))).blob()
			);
			// Without one, it is saved all the same: the list shows the gamepad instead.
			if (shot) form.append('imagen', shot);
			const res = await fetch(`/api/juegos/partidas/${data.gameId}`, {
				method: 'POST',
				body: form
			});
			if (!res.ok) throw new Error(await res.text());
			close();
			running.displayMessage('Partida guardada', 3000);
		} catch {
			message = 'No se pudo guardar la partida';
		} finally {
			busy = false;
		}
	}

	type Save = { id: number; createdAt: string; picture: string | null };
	let saves = $state<Save[] | null>(null);
	/** The one asked to be deleted: a second press deletes it. */
	let deleting = $state<number | null>(null);

	async function showSaves() {
		saves = null;
		deleting = null;
		message = '';
		pushState('', { gameMenu: 'partidas' });
		menu = 'partidas';
		const res = await fetch(`/api/juegos/partidas/${data.gameId}`).catch(() => null);
		saves = res?.ok ? await res.json() : [];
		if (!res?.ok) message = 'No se pudieron leer las partidas';
		await tick();
		menuBox?.querySelector<HTMLElement>('button')?.focus();
	}

	async function load(save: Save) {
		const running = emulator();
		if (!running || busy) return;
		busy = true;
		message = 'Cargando…';
		try {
			await loadState(running, save.id);
			close();
		} catch {
			message = 'No se pudo cargar la partida';
		} finally {
			busy = false;
		}
	}

	async function remove(save: Save) {
		if (deleting !== save.id) {
			deleting = save.id;
			return;
		}
		const res = await fetch(`/api/juegos/partida/${save.id}`, { method: 'DELETE' }).catch(
			() => null
		);
		if (!res?.ok) {
			message = 'No se pudo borrar la partida';
			return;
		}
		saves = saves?.filter((s) => s.id !== save.id) ?? null;
		deleting = null;
		await tick();
		menuBox?.querySelector<HTMLElement>('button')?.focus();
	}

	/**
	 * The game's shader for the whole house (#176), as in /juegos/shaders: its own, or null for its
	 * console's. Tried on the game behind as the focus moves, and kept with A.
	 */
	let own = $derived<Shader | null>(data.shader.own);
	const shader = $derived(own ?? data.shader.inherited);
	/** The one on the game now, once changed here. */
	let applied: Shader | undefined;
	let pausing: ReturnType<typeof setTimeout> | undefined;

	/**
	 * One on the game. A paused emulator draws nothing, the new shader included: a moment of the
	 * game to show it, paused again after it.
	 */
	function preview(id: Shader) {
		const running = emulator();
		if (!running || id === (applied ?? shader)) return;
		applied = id;
		running.changeSettingOption('shader', id);
		running.play();
		clearTimeout(pausing);
		pausing = setTimeout(() => {
			if (menu) running.pause();
		}, 300);
	}

	function showShaders() {
		message = '';
		pushState('', { gameMenu: 'imagen' });
		menu = 'imagen';
	}

	async function chooseShader(id: Shader | null) {
		if (busy) return;
		busy = true;
		try {
			const res = await fetch(`/api/juegos/shader/${data.gameId}`, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ shader: id })
			});
			if (!res.ok) throw new Error(await res.text());
			own = id;
			skipBack = true;
			menu = 'menu';
			history.back();
		} catch {
			message = 'No se pudo guardar';
		} finally {
			busy = false;
		}
	}

	function restart() {
		emulator()?.gameManager.restart();
		close();
	}

	/** Out of the game, to its page: past the menu's step and the game's. */
	function exit() {
		skipBack = true;
		history.go(-2);
	}

	const when = (iso: string) =>
		new Date(iso).toLocaleString('es', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			hour: '2-digit',
			minute: '2-digit'
		});

	/**
	 * The gamepad in the menu, for who opened it with Select + Start: the cross moves between its
	 * buttons, A presses one and B goes back. Only while it is open; the game has it otherwise.
	 * What is held when it starts (A still down from «Cargar partida» when the list comes up) is
	 * not pressed again: it chose the first saved game by itself.
	 */
	$effect(() => {
		if (!menu) return;
		const buttons = () =>
			navigator
				.getGamepads()
				.find((p) => p?.connected)
				?.buttons.map((b) => b.pressed) ?? [];
		let pressed = buttons();
		let frameId = requestAnimationFrame(function poll() {
			const now = buttons();
			const down = (i: number) => now[i] && !pressed[i];
			if (down(0)) (document.activeElement as HTMLElement | null)?.click();
			else if (down(1)) history.back();
			else if (down(12) || down(14) || down(13) || down(15)) {
				const buttons = [...(menuBox?.querySelectorAll<HTMLElement>('button') ?? [])];
				const at = buttons.indexOf(document.activeElement as HTMLElement);
				const step = down(12) || down(14) ? -1 : 1;
				buttons[Math.min(Math.max(at + step, 0), buttons.length - 1)]?.focus();
			}
			pressed = now;
			frameId = requestAnimationFrame(poll);
		});
		return () => cancelAnimationFrame(frameId);
	});
</script>

<svelte:head>
	<title>{data.title} · JellyCartoon</title>
</svelte:head>

<!-- The whole screen, over the TV view; the remote's Back goes back to the game's page. -->
<iframe
	bind:this={frame}
	{src}
	title={data.title}
	allow="fullscreen; gamepad; autoplay"
	class="fixed inset-0 z-50 h-full w-full border-0 bg-black"
	data-focus
></iframe>

{#if menu}
	<div
		bind:this={menuBox}
		class={[
			'fixed inset-0 z-[60] flex items-center p-12',
			// The shaders at one side, the game to be seen as it is.
			menu === 'imagen' ? 'justify-end' : 'justify-center bg-zinc-950/80 backdrop-blur-sm'
		]}
	>
		{#if menu === 'menu'}
			<div class="w-full max-w-xl">
				<h2 class="mb-2 text-5xl font-bold">{data.title}</h2>
				<p class="mb-8 text-xl text-zinc-400">En pausa · Atrás para seguir jugando</p>
				<div class="flex flex-col gap-3">
					{#each [{ label: 'Continuar', run: close }, { label: 'Guardar partida', run: save }, { label: 'Cargar partida', run: showSaves }, { label: `Imagen: ${shaderName(shader)}`, run: showShaders }, { label: 'Reiniciar', run: restart }, { label: 'Salir', run: exit }] as option (option.run)}
						<button
							class="rounded-2xl border-2 border-white/10 bg-zinc-900 px-8 py-4 text-left text-3xl font-semibold transition duration-150 focus-visible:scale-105 focus-visible:border-lime-300 focus-visible:bg-zinc-800 disabled:opacity-50"
							disabled={busy}
							onclick={option.run}>{option.label}</button
						>
					{/each}
				</div>
				{#if message}
					<p class="mt-6 text-2xl text-zinc-300">{message}</p>
				{/if}
			</div>
		{:else if menu === 'imagen'}
			<div class="flex max-h-full w-full max-w-md flex-col rounded-3xl bg-zinc-950/90 p-6">
				<h2 class="mb-1 text-4xl font-bold">Imagen</h2>
				<p class="mb-4 text-lg text-zinc-400">Para toda la casa · Atrás para dejarla como estaba</p>
				{#if message}
					<p class="mb-4 text-xl text-zinc-300">{message}</p>
				{/if}
				<div class="flex flex-col gap-2 overflow-y-auto p-1">
					{#each [{ id: null, name: `Como su consola (${shaderName(data.shader.inherited)})`, description: '' }, ...SHADERS] as s (s.id)}
						<button
							class="rounded-xl border-2 border-white/10 bg-zinc-900 px-5 py-2 text-left transition duration-150 focus-visible:scale-105 focus-visible:border-lime-300 focus-visible:bg-zinc-800 disabled:opacity-50"
							aria-current={s.id === own}
							disabled={busy}
							onfocus={() => preview(s.id ?? data.shader.inherited)}
							onclick={() => chooseShader(s.id)}
						>
							<span class="block text-2xl font-semibold"
								>{s.name}{#if s.id === own}<span class="text-lime-300"> ✓</span>{/if}</span
							>
							{#if s.description}
								<span class="block text-lg text-zinc-400">{s.description}</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{:else}
			<div class="flex max-h-full w-full max-w-6xl flex-col">
				<h2 class="mb-2 text-5xl font-bold">Partidas guardadas</h2>
				<p class="mb-8 text-xl text-zinc-400">Atrás para volver al menú</p>
				{#if message}
					<p class="mb-6 text-2xl text-zinc-300">{message}</p>
				{/if}
				{#if saves === null}
					<p class="text-2xl text-zinc-400">Buscando…</p>
				{:else if !saves.length}
					<p class="text-2xl text-zinc-400">Todavía no hay partidas guardadas de este juego.</p>
				{:else}
					<div class="grid grid-cols-3 gap-6 overflow-y-auto p-2">
						{#each saves as s (s.id)}
							<div class="flex flex-col gap-2">
								<button
									class="block rounded-xl border-2 border-white/10 bg-zinc-900 p-2 text-left transition duration-150 focus-visible:scale-105 focus-visible:border-lime-300"
									disabled={busy}
									onclick={() => load(s)}
								>
									{#if s.picture}
										<img
											src={s.picture}
											alt=""
											class="pixelated aspect-[4/3] w-full rounded-lg bg-zinc-800 object-cover"
										/>
									{:else}
										<span
											class="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-zinc-800 text-zinc-600"
											><SectionIcon name="juegos" class="h-1/3 w-1/3" /></span
										>
									{/if}
									<span class="mt-2 block text-xl first-letter:uppercase">{when(s.createdAt)}</span>
								</button>
								<button
									class={[
										'rounded-lg px-4 py-1 text-lg transition duration-150 focus-visible:scale-105',
										deleting === s.id ? 'bg-red-900 text-red-100' : 'text-zinc-500'
									]}
									onclick={() => remove(s)}
									>{deleting === s.id ? 'Pulsa otra vez para borrarla' : 'Borrar'}</button
								>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.pixelated {
		image-rendering: pixelated;
	}
</style>
