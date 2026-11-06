<script lang="ts">
	import Backdrop from 'comun/components/Backdrop.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import SaveDeleteButton from 'comun/components/games/SaveDeleteButton.svelte';
	import { formatPlayed } from 'comun/format.ts';
	import type { GameInfo, GameSummary } from 'comun/games.ts';

	/** A game's page in the browser (#405): «Jugar», going on from a saved game, and what it is. */
	let {
		system,
		file,
		game,
		backdrop,
		info
	}: {
		system: string;
		file: string;
		game: GameSummary;
		backdrop: Promise<string | null>;
		info: Promise<GameInfo | null> | GameInfo | null;
	} = $props();

	/** The saved games deleted here, until the page is read again. */
	let deleted = $state<number[]>([]);
	let problem = $state(false);
	const saves = $derived(game.saves.filter((s) => !deleted.includes(s.id)));

	const here = $derived(`/juegos/${encodeURIComponent(system)}/${encodeURIComponent(file)}`);
	const when = (iso: string) =>
		new Date(iso).toLocaleString('es', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			hour: '2-digit',
			minute: '2-digit'
		});
</script>

{#await backdrop then src}
	{#if src}
		<Backdrop {src} pixelated />
	{/if}
{/await}

<a href="/juegos/{encodeURIComponent(system)}" class="text-sm text-zinc-400 hover:text-white"
	>← {game.system}</a
>
<h1 class="mt-2 mb-4 text-2xl font-bold [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]">{game.title}</h1>

<a
	href="{here}/jugar"
	class="inline-flex items-center gap-2 rounded-lg bg-lime-400 px-6 py-3 font-semibold text-zinc-950 hover:bg-lime-300"
	><SectionIcon name="juegos" class="h-6 w-6" />Jugar</a
>
{#if game.played.seconds >= 60 && game.played.last}
	<p class="mt-3 text-sm text-zinc-300">
		Has jugado {formatPlayed(game.played.seconds)} · la última vez, {when(game.played.last)}
	</p>
{/if}

{#if saves.length}
	<section class="mt-8">
		<h2 class="mb-3 font-semibold">Partidas guardadas</h2>
		{#if problem}
			<p role="alert" class="mb-3 text-sm text-red-300">No se pudo borrar la partida.</p>
		{/if}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each saves as save (save.id)}
				<div class="group">
					<a href="{here}/jugar?partida={save.id}" class="block">
						<div class="aspect-[4/3] overflow-hidden rounded-lg bg-zinc-800">
							{#if save.picture}
								<img
									src={save.picture}
									alt=""
									loading="lazy"
									class="h-full w-full object-cover [image-rendering:pixelated]"
								/>
							{:else}
								<span class="flex h-full items-center justify-center text-zinc-600"
									><SectionIcon name="juegos" class="h-1/3 w-1/3" /></span
								>
							{/if}
						</div>
					</a>
					<div class="mt-1 flex items-start gap-1">
						<p
							class="min-w-0 flex-1 text-sm group-has-[a:hover]:text-lime-300 first-letter:uppercase"
						>
							{when(save.createdAt)}
						</p>
						<SaveDeleteButton
							saveId={save.id}
							label={when(save.createdAt)}
							class="h-10 w-10"
							ondeleted={() => {
								problem = false;
								deleted.push(save.id);
							}}
							onfailed={() => (problem = true)}
						/>
					</div>
				</div>
			{/each}
		</div>
	</section>
{/if}

{#await info then found}
	{#if found?.status === 'found'}
		{@const facts = [
			found.year,
			found.developers.join(', '),
			found.genres.join(', '),
			found.modes.join(', ')
		].filter(Boolean)}
		<section class="mt-8 max-w-3xl">
			{#if facts.length}<p class="text-sm text-zinc-400">{facts.join(' · ')}</p>{/if}
			{#if found.composers.length}
				<p class="text-sm text-zinc-500">Música: {found.composers.join(', ')}</p>
			{/if}
			{#if found.synopsis}<p class="mt-3 leading-relaxed text-zinc-200">{found.synopsis}</p>{/if}
		</section>
	{/if}
{/await}
