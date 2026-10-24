<script lang="ts" module>
	export interface Moment {
		/** The second of its frame. */
		at: number;
		/** Where «Ver desde aquí» starts: the frame's second, or the start of its scene. */
		playAt: number;
		/** e.g. the scene's name. */
		caption?: string | null;
	}
</script>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { CLIP_SECONDS } from '#lib/birds-eye.ts';
	import { formatDuration } from '#lib/format.ts';
	import { page } from '$app/state';
	import { chooseFilmBackdrop } from '#lib/backdrop.svelte.ts';

	interface Props {
		movieId: number;
		moments: Moment[];
		/** Whether «Ver desde aquí» can play it on the host's screen. */
		mpv: boolean;
	}

	let { movieId, moments, mpv }: Props = $props();

	let selected = $state(0);
	let playing = $state<string | null>(null);
	let failed = $state<string | null>(null);
	/** The clip of the moment shows instead of its frame: loading, or ready to play. */
	let clip = $state<'loading' | 'ready' | null>(null);
	let dialog = $state<HTMLDialogElement>();
	/** «Usar de fondo»: the frame on screen, behind the top of the film's page. */
	let backdrop = $state<'idle' | 'saving' | 'done' | 'failed'>('idle');

	async function useAsBackdrop(at: number) {
		backdrop = 'saving';
		backdrop = (await chooseFilmBackdrop(movieId, at)) ? 'done' : 'failed';
		setTimeout(() => (backdrop = 'idle'), 2000);
	}

	const src = (at: number, width?: number) =>
		`/api/movie-frame/${movieId}/${at}${width ? `?w=${width}` : ''}`;
	const time = (seconds: number) => formatDuration(seconds) || '0:00';

	/** Shows the moment in big. */
	export function open(index: number) {
		selected = index;
		playing = failed = clip = null;
		dialog?.showModal();
	}

	const move = (step: number) => {
		selected = (selected + step + moments.length) % moments.length;
		playing = failed = clip = null;
	};

	const button = 'rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800';
	const primary =
		'rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400';
</script>

<dialog
	bind:this={dialog}
	closedby="any"
	onclose={() => (clip = null)}
	onkeydown={(e) => {
		// In the clip, the arrows seek.
		if (e.target instanceof HTMLVideoElement) return;
		if (e.key === 'ArrowLeft') move(-1);
		if (e.key === 'ArrowRight') move(1);
	}}
	class="m-auto w-5xl max-w-[calc(100vw-1rem)] rounded-md border border-zinc-700 bg-zinc-900 p-3 text-zinc-100 shadow-lg backdrop:bg-zinc-950/80"
>
	{#if moments[selected]}
		{@const moment = moments[selected]}
		<!-- The small one, already loaded, shows until the big one arrives. -->
		<div
			class="relative aspect-video w-full rounded bg-zinc-800 bg-cover bg-center"
			style:background-image="url({src(moment.at)})"
		>
			{#if clip}
				<!-- svelte-ignore a11y_media_has_caption: the film's subtitles are not in the clip -->
				<video
					src="/api/movie-clip/{movieId}/{moment.playAt}"
					poster={src(moment.at, 1280)}
					controls
					autoplay
					playsinline
					class="h-full w-full rounded bg-black object-contain"
					oncanplay={() => (clip = 'ready')}
					onerror={() => {
						clip = null;
						failed = 'No se pudo sacar el clip';
					}}
				></video>
				{#if clip === 'loading'}
					<p
						class="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded bg-zinc-950/80 px-2 py-1 text-sm text-amber-400"
					>
						Preparando el clip…
					</p>
				{/if}
			{:else}
				{#key moment.at}
					<img
						src={src(moment.at, 1280)}
						alt="Fotograma en {time(moment.at)}"
						class="h-full w-full rounded object-contain"
					/>
				{/key}
			{/if}
		</div>
		{#if moment.caption}
			<p class="mt-3">{moment.caption}</p>
		{/if}
		<div class="mt-3 flex flex-wrap items-center gap-2">
			<button onclick={() => move(-1)} class={button} aria-label="Anterior">‹</button>
			<span class="text-sm text-zinc-300 tabular-nums">{time(moment.playAt)}</span>
			<button onclick={() => move(1)} class={button} aria-label="Siguiente">›</button>
			{#if !clip}
				<button
					onclick={() => {
						clip = 'loading';
						failed = null;
					}}
					class={mpv ? button : primary}
					title="Aquí, en este dispositivo">▶︎ Clip de {CLIP_SECONDS} s</button
				>
			{/if}
			{#if mpv}
				<form
					method="post"
					action="?/play"
					use:enhance={() =>
						async ({ result }) => {
							if (result.type === 'success') playing = time(moment.playAt);
							else if (result.type === 'failure')
								failed = String(result.data?.message ?? 'No se pudo reproducir');
						}}
				>
					<input type="hidden" name="id" value={movieId} />
					<input type="hidden" name="at" value={moment.playAt} />
					<button class={primary}>▶︎ Ver desde aquí en el salón</button>
				</form>
			{/if}
			{#if !page.data.kid}
				<button
					class={button}
					disabled={backdrop === 'saving'}
					title="Poner este fotograma arriba en la página de la película"
					onclick={() => useAsBackdrop(moment.at)}
					>{{
						idle: 'Usar de fondo',
						saving: 'Guardando…',
						done: '✓ Fondo cambiado',
						failed: 'No se pudo'
					}[backdrop]}</button
				>
			{/if}
			<form method="dialog" class="ml-auto">
				<button class={button}>Cerrar</button>
			</form>
		</div>
		{#if playing}
			<p class="mt-2 text-sm text-amber-400">
				▶︎ En el salón desde {playing}. <a href="/salon" class="underline">Abrir el mando</a>
			</p>
		{/if}
		{#if failed}
			<p class="mt-2 text-sm text-red-400">{failed}</p>
		{/if}
	{/if}
</dialog>
