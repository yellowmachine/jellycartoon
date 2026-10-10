<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDuration } from '#lib/format.ts';

	interface Props {
		episode: {
			id: number;
			status: string;
			positionSec: number | null;
			completed: boolean | null;
			/** Path to the video on the host, for mpv; only once converted. */
			playlist?: string | null;
		};
		/** Episodes before this one in the series not watched yet. */
		previousUnwatched: number;
		/** The user's lists, and whether this episode is in each one. */
		lists: { id: number; name: string; added: boolean }[];
		onrename: () => void;
	}

	let { episode, previousUnwatched, lists, onrename }: Props = $props();

	const id = $derived(`episode-menu-${episode.id}`);
	const ready = $derived(episode.status === 'ready');
	// The player ignores the first seconds too: it starts over below that.
	const resumeAt = $derived(
		!episode.completed && episode.positionSec && episode.positionSec > 5 ? episode.positionSec : 0
	);

	let menu = $state<HTMLElement>();
	const close = () => menu?.hidePopover();

	let copied = $state(false);
	/** The clipboard only works over https or localhost: otherwise the path is shown to copy by hand. */
	let showingPath = $state(false);
	let pathInput = $state<HTMLInputElement>();
	$effect(() => pathInput?.select());

	async function copyPath() {
		if (window.isSecureContext && navigator.clipboard) {
			try {
				await navigator.clipboard.writeText(episode.playlist!);
				copied = true;
				setTimeout(() => {
					copied = false;
					close();
				}, 800);
				return;
			} catch {
				// Denied: fall back to showing it.
			}
		}
		showingPath = true;
	}
</script>

{#snippet item(label: string)}
	<span class="block w-full rounded px-3 py-1.5 text-left hover:bg-zinc-800">{label}</span>
{/snippet}

<button
	class="shrink-0 rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
	title="Más acciones"
	aria-label="Más acciones"
	popovertarget={id}
	style:anchor-name="--{id}">⋯</button
>

<div
	bind:this={menu}
	{id}
	popover="auto"
	ontoggle={(e) => e.newState === 'closed' && (showingPath = false)}
	style:position-anchor="--{id}"
	class="episode-menu inset-auto m-0 mt-1 w-64 rounded-md border border-zinc-700 bg-zinc-900 p-1 text-sm shadow-lg"
>
	{#if ready}
		{#if resumeAt}
			<a href="/watch/{episode.id}">{@render item(`Continuar desde ${formatDuration(resumeAt)}`)}</a
			>
		{/if}
		<a href="/watch/{episode.id}?t=0">{@render item('Empezar desde el principio')}</a>
		<form
			method="post"
			action="?/setWatched"
			use:enhance={() =>
				async ({ update }) => {
					await update();
					close();
				}}
		>
			<input type="hidden" name="id" value={episode.id} />
			<input type="hidden" name="watched" value={String(!episode.completed)} />
			<button class="w-full">
				{@render item(episode.completed ? 'Marcar como no visto' : 'Marcar como visto')}
			</button>
		</form>
		{#if previousUnwatched}
			<form
				method="post"
				action="?/markPreviousWatched"
				use:enhance={() =>
					async ({ update }) => {
						await update();
						close();
					}}
			>
				<input type="hidden" name="id" value={episode.id} />
				<button class="w-full">
					{@render item(
						previousUnwatched === 1
							? 'Marcar el anterior como visto'
							: `Marcar los ${previousUnwatched} anteriores como vistos`
					)}
				</button>
			</form>
		{/if}

		<hr class="my-1 border-zinc-800" />
		<p class="px-3 pt-1 pb-0.5 text-xs text-zinc-500">Añadir a</p>
		{#each lists as list (list.id)}
			<!-- Stays open: it is common to add the same episode to several lists. -->
			<form method="post" action="?/toggleList" use:enhance>
				<input type="hidden" name="id" value={episode.id} />
				<input type="hidden" name="list" value={list.id} />
				<button
					class="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left hover:bg-zinc-800"
					aria-pressed={list.added}
				>
					<span class="w-4 shrink-0 text-amber-400">{list.added ? '✓' : ''}</span>
					<span class="truncate">{list.name}</span>
				</button>
			</form>
		{:else}
			<a href="/lists">{@render item('Crear una lista…')}</a>
		{/each}
		<hr class="my-1 border-zinc-800" />
	{/if}

	<button
		class="w-full"
		onclick={() => {
			close();
			onrename();
		}}
	>
		{@render item('Editar título')}
	</button>
	{#if episode.playlist}
		<button class="w-full" onclick={copyPath}>
			{@render item(copied ? '✓ Ruta copiada' : 'Copiar ruta (para mpv u otro reproductor)')}
		</button>
		{#if showingPath}
			<div class="px-3 pb-2">
				<input
					bind:this={pathInput}
					readonly
					value={episode.playlist}
					aria-label="Ruta del vídeo"
					class="w-full rounded border-zinc-700 bg-zinc-950 py-1 font-mono text-xs"
				/>
				<p class="mt-1 text-xs text-zinc-400">Ctrl+C para copiar</p>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* Below the button, aligned to its right edge; above it if there is no room underneath. */
	.episode-menu {
		position-area: bottom span-left;
		position-try-fallbacks: flip-block;
	}
</style>
