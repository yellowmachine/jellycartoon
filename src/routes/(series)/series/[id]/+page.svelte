<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll, snapshot } from '$app/navigation';
	import { SvelteSet } from 'svelte/reactivity';
	import DeleteEpisodesDialog from '#lib/components/DeleteEpisodesDialog.svelte';
	import EpisodeMenu from '#lib/components/EpisodeMenu.svelte';
	import EpisodePreview from '#lib/components/EpisodePreview.svelte';
	import EpisodeTitles from '#lib/components/EpisodeTitles.svelte';
	import SeriesInfo from '#lib/components/SeriesInfo.svelte';
	import TagBar from '#lib/components/TagBar.svelte';
	import TitleForm from '#lib/components/TitleForm.svelte';
	import { saveView } from '#lib/views.ts';
	import { formatBytes, formatDuration } from '#lib/format.ts';
	import { languageLabel, normalizeLang } from '#lib/languages.ts';
	import { poll } from '#lib/poll.ts';
	import { thumbUrl } from '#lib/thumb.svelte.ts';
	import Backdrop from '#lib/components/Backdrop.svelte';
	import { backdropUrl, resetSeriesBackdrop } from '#lib/backdrop.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// While Whisper makes subtitles, or the model labels episodes, the page follows how it goes.
	const makingSubtitles = $derived(
		data.seasons.some((s) =>
			s.episodes.some(
				(e) =>
					(e.autoSubtitles?.job && e.autoSubtitles.job.state !== 'failed') ||
					(e.labelJob && e.labelJob.state !== 'failed')
			)
		)
	);
	$effect(() => {
		if (!makingSubtitles) return;
		return poll(invalidateAll, 3000);
	});
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
	/** Only the episodes where the model saw this label (episode-labels.ts), or all. */
	let label = $state<string | null>(null);
	// Kept when coming back to the page (e.g. from an episode), and back to all when entering a
	// series anew: https://svelte.dev/docs/kit/$app-navigation#snapshot
	snapshot({
		capture: () => ({ season, audio, label }),
		restore: (value) => ({ season, audio, label } = value),
		reset: () => {
			season = null;
			audio = null;
			label = null;
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
	/** A label of a set, as the filter keeps it: two sets may have the same label. */
	const labelKey = (l: { set: string; label: string }) => `${l.set}\n${l.label}`;
	/** The labels seen in some episode of the series, by set and by name. */
	let labelOptions = $derived(
		Map.groupBy(
			[
				...new Map(
					data.seasons.flatMap((s) =>
						s.episodes.flatMap((e) => e.labels.map((l) => [labelKey(l), l] as const))
					)
				).values()
			].sort((a, b) => a.set.localeCompare(b.set) || a.label.localeCompare(b.label)),
			(l) => l.set
		)
	);
	/** While selecting, only the episodes whose title contains this text are shown. */
	let filter = $state('');
	let matchCase = $state(false);
	let visibleSeasons = $derived.by(() => {
		// A season left empty (its episodes moved away) shows them all.
		const seasons = data.seasons.some((s) => s.season === season)
			? data.seasons.filter((s) => s.season === season)
			: data.seasons;
		const lang = audio && audioOptions.includes(audio) ? audio : null;
		const seen =
			label && [...labelOptions.values()].flat().some((l) => labelKey(l) === label) ? label : null;
		const needle = selecting && filter ? (matchCase ? filter : filter.toLocaleLowerCase()) : '';
		if (!lang && !seen && !needle) return seasons;
		return seasons
			.map(({ season, episodes }) => ({
				season,
				episodes: episodes.filter(
					(ep) =>
						(!lang || audioLangs(ep).has(lang)) &&
						(!seen || ep.labels.some((l) => labelKey(l) === seen)) &&
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

	/** The languages that some selected episode has audio in without subtitles of its own. */
	const subtitleLanguages = $derived.by(() => {
		const found = new Map<string, string>();
		for (const { episodes } of data.seasons)
			for (const ep of episodes)
				if (selected.has(ep.id))
					for (const l of ep.autoSubtitles?.languages ?? []) found.set(l.lang, l.label);
		return [...found].map(([lang, label]) => ({ lang, label }));
	});
	let subtitleLang = $state('');
	// The first one there is, until one is chosen; another if the chosen one is no longer offered.
	$effect(() => {
		if (!subtitleLanguages.some((l) => l.lang === subtitleLang))
			subtitleLang = subtitleLanguages[0]?.lang ?? '';
	});

	/** This series' episodes waiting for their subtitles: they can be taken out of the queue. */
	const waitingSubtitles = $derived(
		data.seasons.reduce(
			(n, s) => n + s.episodes.filter((e) => e.autoSubtitles?.job?.state === 'queued').length,
			0
		)
	);

	/** This series' episodes waiting to be labelled, or whose labelling failed. */
	const waitingLabels = $derived(
		data.seasons.reduce(
			(n, s) => n + s.episodes.filter((e) => e.labelJob && e.labelJob.state !== 'running').length,
			0
		)
	);

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

<Backdrop src={backdropUrl('serie', data.series.id)} />
{#if !data.kid && data.series.backdropEpisodeId !== null}
	<button
		class="mb-2 text-xs text-zinc-500 hover:text-zinc-300"
		title="El fondo de arriba lo vuelve a elegir la app"
		onclick={async () => {
			if (await resetSeriesBackdrop(data.series.id)) await invalidateAll();
		}}>Fondo elegido a mano · volver al automático</button
	>
{/if}

<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
	{#if editing === 'series'}
		<TitleForm action="?/renameSeries" value={data.series.title} onclose={() => (editing = null)} />
	{:else}
		<h1 class="flex items-center gap-2 text-2xl font-bold [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]">
			{data.series.title}
			{#if !data.kid}{@render editButton('series', 'Cambiar título de la serie')}{/if}
		</h1>
	{/if}
</div>
{#if !data.kid}
	<TagBar tags={data.tags} allTags={data.allTags} class="-mt-2 mb-6" />
	<div
		class="mb-6 flex flex-col items-start gap-2 text-sm text-zinc-400 [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]"
	>
		<form method="post" action="?/serialized" use:enhance>
			<input type="hidden" name="serialized" value={String(!data.series.serialized)} />
			<button class="flex items-center gap-2 hover:text-white">
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
		<!-- The files do not say what language its audio is in: told here, it is assumed for them. -->
		{#if data.unmarkedAudio || data.series.audioLang}
			<form
				method="post"
				action="?/audioLang"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
				class="flex flex-wrap items-center gap-2"
			>
				<label for="audioLang">Idioma del audio que los ficheros no indican</label>
				<select
					id="audioLang"
					name="audioLang"
					value={data.series.audioLang ?? ''}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
					class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm text-zinc-200"
				>
					<option value="">Desconocido</option>
					{#each data.knownLanguages as lang (lang)}
						<option value={lang}>{languageLabel(lang)}</option>
					{/each}
				</select>
			</form>
		{/if}
	</div>
{/if}
{#if form?.message}
	<p class="-mt-4 mb-4 text-sm text-red-400">{form.message}</p>
{/if}

<SeriesInfo info={data.info} />
{#await data.info then info}
	{#if !data.kid}
		<EpisodeTitles
			proposal={data.proposal}
			canPropose={data.canPropose && 'status' in info && info.status === 'found'}
		/>
	{/if}
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
		{#if labelOptions.size && !data.kid}
			<select
				aria-label="Etiqueta"
				bind:value={
					() => label,
					(v) => {
						label = v;
						unselectHidden();
					}
				}
				class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
			>
				<option value={null}>Todas las etiquetas</option>
				{#each labelOptions as [set, labels] (set)}
					<optgroup label={set}>
						{#each labels as l (l.label)}
							<option value={labelKey(l)}>{l.label}</option>
						{/each}
					</optgroup>
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
		{#if !selecting && !data.kid}
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

{#if waitingSubtitles && !data.kid}
	<form
		method="post"
		action="?/cancelSubtitles"
		use:enhance
		class="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 px-3 py-2 text-sm"
	>
		<span class="text-zinc-400">
			{waitingSubtitles === 1
				? '1 capítulo espera sus subtítulos automáticos.'
				: `${waitingSubtitles} capítulos esperan sus subtítulos automáticos.`}
		</span>
		<button class="text-amber-400 hover:underline">Cancelar los que esperan</button>
	</form>
{/if}

{#if waitingLabels && !data.kid}
	<form
		method="post"
		action="?/cancelLabels"
		use:enhance
		class="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 px-3 py-2 text-sm"
	>
		<span class="text-zinc-400">
			{waitingLabels === 1
				? '1 capítulo espera a que lo etiqueten (o falló).'
				: `${waitingLabels} capítulos esperan a que los etiqueten (o fallaron).`}
		</span>
		<button class="text-amber-400 hover:underline">Quitarlos de la cola</button>
	</form>
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
								{#if !selecting}
									<EpisodePreview id={ep.id} durationSec={ep.durationSec} />
								{/if}
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
									{@const subs = ep.autoSubtitles?.job}
									{formatDuration(ep.durationSec)}{#if ep.completed}
										· visto{/if}{#if subs?.state === 'queued'}
										· subtítulos en cola{:else if subs?.state === 'running'}
										· haciendo subtítulos… {subs.total
											? `${Math.round((subs.done / subs.total) * 100)}%`
											: ''}{:else if subs?.state === 'failed'}
										· <span class="text-red-400" title={subs.message}>subtítulos fallidos</span
										>{/if}{#if !data.kid}{#if ep.labelJob?.state === 'queued'}
											· etiquetas en cola («{ep.labelJob
												.set}»){:else if ep.labelJob?.state === 'running'}
											· etiquetando con «{ep.labelJob.set}»… {ep.labelJob.total
												? `${Math.round((ep.labelJob.done / ep.labelJob.total) * 100)}%`
												: ''}{:else if ep.labelJob?.state === 'failed'}
											· <span class="text-red-400" title={ep.labelJob.message}
												>etiquetado fallido</span
											>{/if}{/if}
									{#if ep.labels.length && !data.kid}
										<!-- What the model saw, by set, the most seen first; how many frames, on hover. -->
										<span class="mt-1 flex flex-wrap gap-1">
											{#each ep.labels as l (labelKey(l))}
												<span
													class="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300"
													title="{l.set} · en {l.frames} {l.frames === 1
														? 'fotograma'
														: 'fotogramas'}">{l.label}</span
												>
											{/each}
										</span>
									{/if}
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
								listen={{
									title: ep.title,
									subtitle: `${data.series.title} · T${ep.season} E${ep.number}`,
									lang: data.audioLang
								}}
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
		<!-- Whisper's, for those without subtitles of their own in that language; the rest are skipped. -->
		{#if subtitleLanguages.length}
			<span class="flex items-center gap-2 text-sm">
				Subtítulos automáticos en
				<select
					name="lang"
					bind:value={subtitleLang}
					class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
				>
					{#each subtitleLanguages as language (language.lang)}
						<option value={language.lang}>{language.label}</option>
					{/each}
				</select>
				<button
					formaction="?/autoSubtitlesMany"
					formnovalidate
					class="rounded-md border border-zinc-700 px-3 py-1 hover:bg-zinc-900">Hacer</button
				>
			</span>
		{/if}
		<!-- Ollama's vision model, with a set of Ajustes → Casa: again replaces what that set saw. -->
		{#if data.labelSets.length}
			<span class="flex items-center gap-2 text-sm">
				Etiquetar con
				<select name="labelSet" class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm">
					{#each data.labelSets as set (set.id)}
						<option value={set.id}>{set.name}</option>
					{/each}
				</select>
				<button
					formaction="?/labelMany"
					formnovalidate
					disabled={selected.size === 0}
					class="rounded-md border border-zinc-700 px-3 py-1 hover:bg-zinc-900 disabled:opacity-50"
					>Etiquetar</button
				>
			</span>
		{/if}
		<button
			type="button"
			class="rounded-md px-2 py-1 text-sm text-zinc-400 hover:text-white"
			onclick={stopSelecting}>Terminar</button
		>
		<p class="w-full text-xs text-zinc-500">
			Se ponen al final de esa temporada, en el orden que tienen ahora. Si la temporada no existe,
			se crea.
		</p>
		{#if form && 'labelsQueued' in form}
			<p class="w-full text-sm text-amber-400">
				{form.labelsQueued === 1 ? '1 capítulo en cola' : `${form.labelsQueued} capítulos en cola`}
				para etiquetar{form.labelsSkipped
					? ` · ${form.labelsSkipped} ya estaban en cola o no están convertidos`
					: ''}.
			</p>
		{/if}
		{#if form && 'subtitlesQueued' in form}
			<p class="w-full text-sm text-amber-400">
				{form.subtitlesQueued === 1
					? '1 capítulo en cola'
					: `${form.subtitlesQueued} capítulos en cola`}
				para subtítulos{form.subtitlesSkipped
					? ` · ${form.subtitlesSkipped} ya los tenían, ya estaban en cola o no están convertidos`
					: ''}.
			</p>
		{/if}
	</form>
{/if}

<DeleteEpisodesDialog bind:this={deleteDialog} ondeleted={() => selected.clear()} />

{#if !data.kid}
	<section class="mt-10 border-t border-zinc-800 pt-6">
		{#if confirmDelete}
			<p class="mb-3 text-sm text-zinc-400">
				Se borran {data.stored.episodes} episodios convertidos ({formatBytes(
					data.stored.outputBytes
				)}) y el progreso de visionado. Los originales no se tocan: si siguen en la carpeta de
				medios, la serie volverá en el próximo escaneo.
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
{/if}
