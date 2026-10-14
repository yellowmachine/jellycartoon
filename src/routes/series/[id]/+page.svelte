<script lang="ts">
	import { enhance } from '$app/forms';
	import { snapshot } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import DeleteEpisodesDialog from '#lib/components/DeleteEpisodesDialog.svelte';
	import EpisodeMenu from '#lib/components/EpisodeMenu.svelte';
	import EpisodeTitles from '#lib/components/EpisodeTitles.svelte';
	import SeriesInfo from '#lib/components/SeriesInfo.svelte';
	import TitleForm from '#lib/components/TitleForm.svelte';
	import { saveView } from '#lib/views.ts';
	import { formatBytes, formatDuration } from '#lib/format.ts';
	import { languageLabel, normalizeLang } from '#lib/languages.ts';
	import { thumbUrl } from '#lib/thumb.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	/** From the cookie; changed here at once when an icon is clicked. */
	let view = $derived(data.view);
	let grid = $derived(view === 'grid');
	let confirmDelete = $state(false);
	/** What is being renamed: the series, an episode id, or nothing. */
	let editing = $state<'series' | number | null>(null);
	/** `listId:episodeId` of every episode of the series already in one of the user's lists. */
	/** For each episode, how many before it in the series are not watched yet. */
	let previousUnwatched = $derived.by(() => {
		const counts = new Map<number, number>();
		let unwatched = 0;
		for (const { episodes } of data.seasons) {
			for (const ep of episodes) {
				counts.set(ep.id, unwatched);
				if (!ep.completed) unwatched++;
			}
		}
		return counts;
	});
	let otherTags = $derived(data.allTags.filter((name) => !data.tags.some((t) => t.name === name)));
	let inList = $derived(new Set(data.listItems.map((i) => `${i.listId}:${i.episodeId}`)));

	/** Selection mode, to move episodes to another season. */
	let selecting = $state(false);
	const selected = new SvelteSet<number>();
	let targetSeason = $state<number | null>(null);
	let deleteDialog = $state<DeleteEpisodesDialog>();
	/** The only season shown, or all. */
	let season = $state<number | null>(null);
	/** Only the episodes with an audio track in this language, or all. */
	let audio = $state<string | null>(null);
	// Kept when coming back to the page (e.g. from an episode), and back to all when entering a
	// series anew: https://svelte.dev/docs/kit/$app-navigation#snapshot
	snapshot({
		capture: () => ({ season, audio }),
		restore: (value) => ({ season, audio } = value),
		reset: () => {
			season = null;
			audio = null;
		}
	});
	const audioLangs = (ep: { audioTracks: { lang: string }[] }) =>
		new Set(ep.audioTracks.map((t) => normalizeLang(t.lang)));
	/**
	 * The audio languages of the series, worth filtering by: those that some episodes have and
	 * others do not. Only converted episodes have their tracks.
	 */
	let audioOptions = $derived.by(() => {
		const episodes = data.seasons.flatMap((s) => s.episodes);
		const counts = new Map<string, number>();
		for (const ep of episodes)
			for (const lang of audioLangs(ep)) counts.set(lang, (counts.get(lang) ?? 0) + 1);
		const langs = [...counts.keys()].sort((a, b) =>
			languageLabel(a).localeCompare(languageLabel(b))
		);
		return langs.some((lang) => counts.get(lang)! < episodes.length) ? langs : [];
	});
	/** While selecting, only the episodes whose title contains this text are shown. */
	let filter = $state('');
	let matchCase = $state(false);
	let visibleSeasons = $derived.by(() => {
		// A season left empty (its episodes moved away) shows them all.
		const seasons = data.seasons.some((s) => s.season === season)
			? data.seasons.filter((s) => s.season === season)
			: data.seasons;
		const lang = audio && audioOptions.includes(audio) ? audio : null;
		const needle = selecting && filter ? (matchCase ? filter : filter.toLocaleLowerCase()) : '';
		if (!lang && !needle) return seasons;
		return seasons
			.map(({ season, episodes }) => ({
				season,
				episodes: episodes.filter(
					(ep) =>
						(!lang || audioLangs(ep).has(lang)) &&
						(matchCase ? ep.title : ep.title.toLocaleLowerCase()).includes(needle)
				)
			}))
			.filter(({ episodes }) => episodes.length > 0);
	});
	let visibleIds = $derived(visibleSeasons.flatMap(({ episodes }) => episodes.map((e) => e.id)));
	/** What the filter hides is unselected too: a hidden selection would be confusing. */
	function unselectHidden() {
		const visible = new Set(visibleIds);
		for (const id of selected) if (!visible.has(id)) selected.delete(id);
	}

	function toggleSeason(ids: number[], on: boolean) {
		for (const id of ids) {
			if (on) selected.add(id);
			else selected.delete(id);
		}
	}

	function stopSelecting() {
		selecting = false;
		selected.clear();
		filter = '';
	}
</script>

{#snippet editButton(target: 'series' | number, label: string)}
	<button
		class="shrink-0 rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
		title={label}
		aria-label={label}
		onclick={() => (editing = target)}>✎</button
	>
{/snippet}

<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
	{#if editing === 'series'}
		<TitleForm action="?/renameSeries" value={data.series.title} onclose={() => (editing = null)} />
	{:else}
		<h1 class="flex items-center gap-2 text-2xl font-bold">
			{data.series.title}
			{@render editButton('series', 'Cambiar título de la serie')}
		</h1>
	{/if}
	<form method="post" action="?/serialized" use:enhance class="text-sm">
		<input type="hidden" name="serialized" value={String(!data.series.serialized)} />
		<button class="flex items-center gap-2 text-zinc-400 hover:text-white">
			<span
				class={[
					'relative h-5 w-9 rounded-full transition',
					data.series.serialized ? 'bg-amber-500' : 'bg-zinc-700'
				]}
			>
				<span
					class={[
						'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
						data.series.serialized ? 'left-4.5' : 'left-0.5'
					]}
				></span>
			</span>
			{data.series.serialized ? 'Con continuidad: en orden' : 'Episodios sueltos: al azar'}
		</button>
	</form>
</div>
<div class="-mt-2 mb-6 flex flex-wrap items-center gap-2 text-sm">
	{#each data.tags as tag (tag.id)}
		<form method="post" action="?/removeTag" use:enhance>
			<input type="hidden" name="tagId" value={tag.id} />
			<span
				class="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 py-0.5 pr-1 pl-3"
			>
				{tag.name}
				<button
					class="rounded-full px-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
					title="Quitar la etiqueta «{tag.name}»"
					aria-label="Quitar la etiqueta «{tag.name}»">×</button
				>
			</span>
		</form>
	{/each}
	<!-- Tags other series already have: one click instead of typing them again. -->
	{#each otherTags as name (name)}
		<form method="post" action="?/addTag" use:enhance>
			<input type="hidden" name="name" value={name} />
			<button
				class="rounded-full border border-dashed border-zinc-700 px-3 py-0.5 text-zinc-500 hover:border-zinc-500 hover:text-white"
				title="Añadir la etiqueta «{name}»">+ {name}</button
			>
		</form>
	{/each}
	<form method="post" action="?/addTag" use:enhance>
		<input
			name="name"
			maxlength="40"
			autocomplete="off"
			placeholder="Nueva etiqueta"
			aria-label="Nueva etiqueta"
			class="w-36 rounded-full border-zinc-700 bg-zinc-900 px-3 py-0.5 text-sm"
		/>
	</form>
	<a
		href="/library/etiquetas"
		class="text-zinc-500 hover:text-white"
		title="Renombrar, juntar o borrar etiquetas en todas las series">Gestionar etiquetas</a
	>
</div>
{#if form?.message}
	<p class="-mt-4 mb-4 text-sm text-red-400">{form.message}</p>
{/if}

<SeriesInfo info={data.info} />
{#await data.info then info}
	<EpisodeTitles
		proposal={data.proposal}
		canPropose={data.canPropose && 'status' in info && info.status === 'found'}
	/>
{/await}

<div class="mb-2 flex flex-wrap items-center justify-between gap-3">
	<p class="text-sm text-zinc-400">
		{#if data.activeList}
			Añadiendo a la lista
			<a href="/lists/{data.activeList.id}" class="text-amber-400 hover:underline"
				>{data.activeList.name}</a
			>
		{:else}
			<a href="/lists" class="hover:text-white">Activa una lista</a> para añadirle capítulos de esta serie.
		{/if}
	</p>
	<div class="flex items-center gap-2">
		{#if data.seasons.length > 1}
			<select
				aria-label="Temporada"
				bind:value={
					() => season,
					(v) => {
						season = v;
						unselectHidden();
					}
				}
				class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
			>
				<option value={null}>Todas las temporadas</option>
				{#each data.seasons as { season: number } (number)}
					<option value={number}>Temporada {number}</option>
				{/each}
			</select>
		{/if}
		{#if audioOptions.length}
			<select
				aria-label="Idioma de audio"
				bind:value={
					() => audio,
					(v) => {
						audio = v;
						unselectHidden();
					}
				}
				class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
			>
				<option value={null}>Todos los audios</option>
				{#each audioOptions as lang (lang)}
					<option value={lang}>Audio: {languageLabel(lang)}</option>
				{/each}
			</select>
		{/if}
		<div class="flex rounded-md border border-zinc-700 p-0.5" role="group" aria-label="Vista">
			{#each [{ value: 'list', label: 'Ver en lista' }, { value: 'grid', label: 'Ver en cuadrícula' }] as const as { value, label } (value)}
				<button
					class={[
						'rounded px-1.5 py-1',
						view === value ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'
					]}
					title={label}
					aria-label={label}
					aria-pressed={view === value}
					onclick={() => {
						view = value;
						saveView('episodes', value);
					}}
				>
					<svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor" aria-hidden="true">
						{#if value === 'list'}
							<rect x="4" y="5" width="16" height="3" rx="1" />
							<rect x="4" y="10.5" width="16" height="3" rx="1" />
							<rect x="4" y="16" width="16" height="3" rx="1" />
						{:else}
							<rect x="4" y="4" width="7" height="7" rx="1" />
							<rect x="13" y="4" width="7" height="7" rx="1" />
							<rect x="4" y="13" width="7" height="7" rx="1" />
							<rect x="13" y="13" width="7" height="7" rx="1" />
						{/if}
					</svg>
				</button>
			{/each}
		</div>
		{#if !selecting}
			<button
				class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900"
				onclick={() => (selecting = true)}>Seleccionar capítulos</button
			>
		{/if}
	</div>
</div>
{#if selecting}
	<div class="mb-2 flex flex-wrap items-center gap-2">
		<input
			type="search"
			placeholder="Filtrar por título"
			aria-label="Filtrar capítulos por título"
			bind:value={
				() => filter,
				(v) => {
					filter = v;
					unselectHidden();
				}
			}
			class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
		/>
		<button
			type="button"
			class={[
				'rounded-md border px-2 py-1 font-mono text-sm',
				matchCase
					? 'border-amber-500/60 text-amber-400'
					: 'border-zinc-700 text-zinc-400 hover:text-white'
			]}
			title="Distinguir mayúsculas y minúsculas"
			aria-label="Distinguir mayúsculas y minúsculas"
			aria-pressed={matchCase}
			onclick={() => {
				matchCase = !matchCase;
				unselectHidden();
			}}>Aa</button
		>
		{#if filter}
			<button
				type="button"
				disabled={visibleIds.length === 0}
				class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900 disabled:opacity-50"
				onclick={() => toggleSeason(visibleIds, true)}
				>Seleccionar los {visibleIds.length} que coinciden</button
			>
		{/if}
	</div>
	{#if filter && visibleIds.length === 0}
		<p class="mt-4 text-sm text-zinc-500">Ningún capítulo coincide con «{filter}».</p>
	{/if}
{/if}

{#each visibleSeasons as { season, episodes } (season)}
	{@const ids = episodes.map((e) => e.id)}
	<h2 class="mt-6 mb-3 flex items-center gap-3 font-semibold text-zinc-300">
		{#if selecting}
			<input
				type="checkbox"
				class="rounded border-zinc-600 bg-zinc-900 text-amber-500"
				aria-label="Seleccionar toda la temporada {season}"
				checked={ids.every((id) => selected.has(id))}
				onchange={(e) => toggleSeason(ids, e.currentTarget.checked)}
			/>
		{/if}
		Temporada {season}
	</h2>
	<ul
		class={grid
			? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'
			: 'divide-y divide-zinc-800 rounded-md border border-zinc-800'}
	>
		{#each episodes as ep (ep.id)}
			{@const ready = ep.status === 'ready'}
			<li
				class={grid
					? 'flex flex-col overflow-hidden rounded-md border border-zinc-800'
					: 'flex items-center pr-3'}
			>
				{#if editing === ep.id}
					<div class="flex min-w-0 flex-1 items-center gap-3 p-3">
						<span class="shrink-0 text-zinc-400">{ep.number}.</span>
						<TitleForm
							action="?/renameEpisode"
							value={ep.title}
							placeholder={ep.autoTitle}
							hidden={{ id: ep.id }}
							onclose={() => (editing = null)}
						/>
					</div>
				{:else}
					<svelte:element
						this={selecting ? 'label' : ready ? 'a' : 'div'}
						href={ready && !selecting ? `/watch/${ep.id}` : undefined}
						class={[
							'relative flex min-w-0 flex-1',
							grid ? 'flex-col gap-2 p-2' : 'items-center gap-4 p-3',
							selecting && 'cursor-pointer',
							ready || selecting ? 'hover:bg-zinc-900' : 'opacity-60'
						]}
					>
						{#if selecting}
							<input
								type="checkbox"
								class={[
									'rounded border-zinc-600 bg-zinc-900 text-amber-500',
									grid && 'absolute top-3 right-3 z-10'
								]}
								checked={selected.has(ep.id)}
								onchange={(e) => toggleSeason([ep.id], e.currentTarget.checked)}
							/>
						{/if}
						<div
							class={[
								'relative aspect-video shrink-0 overflow-hidden rounded bg-zinc-800',
								grid ? 'w-full' : 'w-32'
							]}
						>
							{#if ready}
								<img
									src={thumbUrl(ep.id)}
									alt=""
									class="h-full w-full object-cover"
									loading="lazy"
								/>
							{/if}
							{#if ep.completed}
								<span
									class="absolute top-1 left-1 rounded bg-zinc-950/80 px-1.5 py-0.5 text-xs font-medium text-amber-400"
									>✓ Visto</span
								>
							{/if}
							<!-- A watched episode has its position reset to 0 (next time starts over): full bar. -->
							{#if (ep.completed || ep.positionSec) && ep.durationSec}
								<div class="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
									<div
										class="h-full bg-amber-400"
										style:width="{ep.completed
											? 100
											: ((ep.positionSec ?? 0) / ep.durationSec) * 100}%"
									></div>
								</div>
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<p class={grid ? 'line-clamp-2 text-sm' : 'truncate'}>{ep.number}. {ep.title}</p>
							<p class="text-xs text-zinc-400">
								{#if ready}
									{formatDuration(ep.durationSec)}{#if ep.completed}
										· visto{/if}
								{:else if ep.status === 'processing'}
									Convirtiendo… {Math.round(ep.progress * 100)}%
								{:else if ep.status === 'error'}
									<span class="text-red-400">Error al convertir</span>
								{:else if ep.status === 'ignored'}
									No se convertirá
								{:else}
									En cola
								{/if}
							</p>
						</div>
					</svelte:element>
					<!-- In the grid, the buttons go in a row under the card. -->
					<div class={grid ? 'mt-auto flex items-center justify-end gap-2 px-2 pb-2' : 'contents'}>
						{#if ready && data.activeList && !selecting}
							{@const added = inList.has(`${data.activeList.id}:${ep.id}`)}
							<form method="post" action="?/toggleList" use:enhance>
								<input type="hidden" name="id" value={ep.id} />
								<button
									class={[
										'shrink-0 rounded-md border px-2 py-1 text-xs',
										added
											? 'border-amber-500/60 text-amber-400 hover:border-red-500/60 hover:text-red-400'
											: 'border-zinc-700 text-zinc-300 hover:bg-zinc-900'
									]}
									title={added
										? `Quitar de «${data.activeList.name}»`
										: `Añadir a «${data.activeList.name}»`}
								>
									{added ? '✓ En la lista' : '+ Lista'}
								</button>
							</form>
						{/if}
						{#if !selecting}
							<EpisodeMenu
								episode={ep}
								salon={data.salon}
								previousUnwatched={previousUnwatched.get(ep.id) ?? 0}
								lists={data.lists.map((l) => ({ ...l, added: inList.has(`${l.id}:${ep.id}`) }))}
								onrename={() => (editing = ep.id)}
								ondelete={() => deleteDialog?.open([ep.id], ep.title)}
							/>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/each}

{#if selecting}
	<form
		method="post"
		action="?/moveToSeason"
		use:enhance={() =>
			async ({ result, update }) => {
				await update({ reset: false });
				if (result.type === 'success') selected.clear();
			}}
		class="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center gap-3 rounded-t-md border border-zinc-700 bg-zinc-950/95 p-3 backdrop-blur"
	>
		{#each selected as id (id)}
			<input type="hidden" name="id" value={id} />
		{/each}
		<span class="text-sm">{selected.size} seleccionados</span>
		<label class="flex items-center gap-2 text-sm">
			Mover a la temporada
			<input
				type="number"
				name="season"
				min="0"
				max="999"
				required
				bind:value={targetSeason}
				class="w-20 rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
			/>
		</label>
		<button
			disabled={selected.size === 0 || targetSeason === null}
			class="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
		>
			Mover
		</button>
		<button
			type="button"
			disabled={selected.size === 0}
			class="rounded-md border border-red-800 px-3 py-1 text-sm text-red-400 hover:border-red-600 hover:bg-red-950 disabled:opacity-50"
			onclick={() => deleteDialog?.open([...selected])}>Borrar</button
		>
		<button
			type="button"
			class="rounded-md px-2 py-1 text-sm text-zinc-400 hover:text-white"
			onclick={stopSelecting}>Terminar</button
		>
		<p class="w-full text-xs text-zinc-500">
			Se ponen al final de esa temporada, en el orden que tienen ahora. Si la temporada no existe,
			se crea.
		</p>
	</form>
{/if}

<DeleteEpisodesDialog bind:this={deleteDialog} ondeleted={() => selected.clear()} />

<section class="mt-10 border-t border-zinc-800 pt-6">
	{#if confirmDelete}
		<p class="mb-3 text-sm text-zinc-400">
			Se borran {data.stored.episodes} episodios convertidos ({formatBytes(
				data.stored.outputBytes
			)}) y el progreso de visionado. Los originales no se tocan: si siguen en la carpeta de medios,
			la serie volverá en el próximo escaneo.
		</p>
		<form method="post" action="?/delete" use:enhance class="flex items-center gap-2">
			<button class="rounded-md bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-500">
				Sí, borrar la serie
			</button>
			<button
				type="button"
				class="rounded-md px-3 py-2 text-zinc-400 hover:text-white"
				onclick={() => (confirmDelete = false)}>Cancelar</button
			>
		</form>
	{:else}
		<button
			class="rounded-md border border-red-800 px-4 py-2 text-sm text-red-400 hover:border-red-600 hover:bg-red-950 hover:text-red-300"
			onclick={() => (confirmDelete = true)}
		>
			Borrar serie
		</button>
	{/if}
</section>
