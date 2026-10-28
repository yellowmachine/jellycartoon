<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { poll } from 'comun/poll.ts';
	import { page } from '$app/state';
	import MovieMenu from '#lib/components/MovieMenu.svelte';
	import TitleForm from '#lib/components/TitleForm.svelte';
	import { formatDuration } from 'comun/format.ts';
	import {
		activeFilters,
		awardFamily,
		decadeOf,
		DURATIONS,
		FILTERS,
		filterLabel,
		matchReason,
		SORTS,
		sortFilms,
		WATCH_STATES,
		type FilterName,
		type SortName
	} from '#lib/film-search.ts';
	import { languageLabel, normalizeLang } from 'comun/languages.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let scanning = $state(false);
	let editing = $state<number | null>(null);
	let search = $state('');

	const filters = $derived(activeFilters(new URLSearchParams(page.url.search)));
	const sort = $derived.by((): SortName => {
		const wanted = page.url.searchParams.get('orden');
		return wanted && wanted in SORTS ? (wanted as SortName) : 'titulo';
	});
	/** Without a filter, the URL that removes it (the order stays). */
	const withoutFilter = (index: number) => {
		const params = new URLSearchParams();
		filters.forEach((f, i) => i !== index && params.append(f.name, f.value));
		if (sort !== 'titulo') params.set('orden', sort);
		return `/cine${params.size ? `?${params}` : ''}`;
	};

	/** A filter's dropdown: one value or none, in the URL like the rest (so «back» undoes it). */
	function choose(name: FilterName | 'orden', value: string) {
		const params = new URLSearchParams(page.url.search);
		params.delete(name);
		if (value && !(name === 'orden' && value === 'titulo')) params.set(name, value);
		// A history entry each: «back» undoes the last one. Scroll and focus stay where they were.
		void goto(`/cine${params.size ? `?${params}` : ''}`, { reset: false });
	}
	const chosen = (name: FilterName) => page.url.searchParams.get(name) ?? '';

	/** Only what there is: the decades, genres and audio languages of these films. */
	const decades = $derived(
		[...new Set(data.movies.flatMap((m) => (m.year ? [decadeOf(m.year)] : [])))].sort(
			(a, b) => b - a
		)
	);
	const genres = $derived(
		[...new Set(data.movies.flatMap((m) => m.genres))].sort((a, b) => a.localeCompare(b, 'es'))
	);
	const audioLangs = $derived(
		[...new Set(data.movies.flatMap((m) => m.audioTracks.map((t) => normalizeLang(t.lang))))]
			.filter((l) => l !== 'und')
			.sort((a, b) => languageLabel(a).localeCompare(languageLabel(b), 'es'))
	);

	/** With why each film matches the search, when its title does not say it. */
	const shown = $derived(
		sortFilms(
			data.movies
				.filter((m) => filters.every((f) => FILTERS[f.name].matches(m, f.value)))
				.map((m) => ({ ...m, reason: matchReason(m, search) }))
				.filter((m) => m.reason !== null),
			sort,
			page.url.searchParams.get('saga')
		)
	);

	/** The awards won (by family), sagas and kinds there are in these films. */
	// The awards most films have first: the big ones on top, local critics' at the bottom.
	const awardFamilies = $derived.by(() => {
		const films = new Map<string, number>();
		for (const m of data.movies)
			for (const family of new Set(m.awards.filter((a) => a.won).map((a) => awardFamily(a.name))))
				films.set(family, (films.get(family) ?? 0) + 1);
		return [...films]
			.sort(([a, n], [b, m]) => m - n || a.localeCompare(b, 'es'))
			.map(([family, count]) => ({ family, count }));
	});
	const sagas = $derived(
		[...new Set(data.movies.flatMap((m) => m.sagas.map((s) => s.name)))].sort((a, b) =>
			a.localeCompare(b, 'es')
		)
	);
	const kinds = $derived({
		bn: data.movies.some((m) => m.blackAndWhite),
		muda: data.movies.some((m) => m.silent)
	});

	/** The filters behind «Más filtros»: open on their own when one is on, so it is never hidden. */
	const ADVANCED: FilterName[] = ['decada', 'premio', 'saga', 'tipo'];
	const advancedActive = $derived(filters.filter((f) => ADVANCED.includes(f.name)).length);
	const hasAdvanced = $derived(
		decades.length > 1 || awardFamilies.length > 0 || sagas.length > 0 || kinds.bn || kinds.muda
	);
	let moreToggled = $state<boolean | null>(null);
	const moreOpen = $derived(moreToggled ?? advancedActive > 0);

	const dropdown = 'rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm';

	// Refresh while films are being catalogued or their info completed; not while a title is
	// being edited.
	$effect(() => {
		if (data.pending === 0 && data.extras.total === 0) return;
		return poll(() => editing === null && invalidateAll(), 3000);
	});
</script>

<svelte:head>
	<title>Cine · JellyCartoon</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<h1 class="mr-auto text-2xl font-bold">Cine</h1>
	<input
		type="search"
		bind:value={search}
		placeholder="Título o persona"
		aria-label="Buscar por título, director, actor, guion, música o fotografía"
		class="w-56 rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
	/>
	{#if !data.kid}
		<form
			method="post"
			action="?/scan"
			use:enhance={() => {
				scanning = true;
				return async ({ update }) => {
					await update();
					scanning = false;
				};
			}}
		>
			<button
				disabled={scanning}
				class="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
			>
				{scanning ? 'Escaneando…' : 'Escanear carpeta'}
			</button>
		</form>
	{/if}
</div>

{#if form && 'playing' in form && form.playing}
	<p class="-mt-4 mb-4 text-sm text-amber-400">▶︎ En el salón: {form.playing}</p>
{/if}
{#if form && 'message' in form && form.message}
	<p class="-mt-4 mb-4 text-sm text-red-400">{form.message}</p>
{/if}
{#if form && 'scan' in form && form.scan}
	<p class="-mt-4 mb-4 text-sm text-zinc-400">
		{form.scan.added} nuevas · {form.scan.changed} cambiadas · {form.scan.missing} desaparecidas
		{#if form.scan.waiting}
			<br />{form.scan.waiting} aún se están copiando: vuelve a escanear en un minuto.
		{/if}
		{#if form.scan.discs.length}
			<br />Sin catalogar, porque son copias de disco (BDMV o VIDEO_TS): {form.scan.discs.join(
				', '
			)}.
		{/if}
	</p>
{/if}
{#if data.pending}
	<p class="mb-4 text-sm text-amber-400">
		Catalogando: quedan {data.pending}. Se saca la duración, las pistas y una miniatura de cada una.
	</p>
{/if}

{#if data.movies.length}
	<!-- What is usually looked for: not watched yet, how long, a genre, the audio. The rest, behind «Más filtros». -->
	<div class="mb-4 flex flex-wrap items-center gap-2">
		<select
			aria-label="Estado"
			class={dropdown}
			value={chosen('estado')}
			onchange={(e) => choose('estado', e.currentTarget.value)}
		>
			<option value="">Vistas o no</option>
			{#each Object.entries(WATCH_STATES) as [value, label] (value)}
				<option {value}>{label}</option>
			{/each}
		</select>
		<select
			aria-label="Duración"
			class={dropdown}
			value={chosen('duracion')}
			onchange={(e) => choose('duracion', e.currentTarget.value)}
		>
			<option value="">Cualquier duración</option>
			{#each Object.entries(DURATIONS) as [value, { label }] (value)}
				<option {value}>{label}</option>
			{/each}
		</select>
		{#if genres.length}
			<select
				aria-label="Género"
				class="{dropdown} max-w-48"
				value={chosen('genero')}
				onchange={(e) => choose('genero', e.currentTarget.value)}
			>
				<option value="">Cualquier género</option>
				{#each genres as genre (genre)}
					<option value={genre}>{genre}</option>
				{/each}
			</select>
		{/if}
		{#if audioLangs.length > 1}
			<select
				aria-label="Idioma del audio"
				class={dropdown}
				value={chosen('audio')}
				onchange={(e) => choose('audio', e.currentTarget.value)}
			>
				<option value="">Cualquier audio</option>
				{#each audioLangs as lang (lang)}
					<option value={lang}>Audio en {languageLabel(lang)}</option>
				{/each}
			</select>
		{/if}
		{#if hasAdvanced}
			<button
				class="{dropdown} px-3 hover:bg-zinc-800"
				aria-expanded={moreOpen}
				aria-controls="more-filters"
				onclick={() => (moreToggled = !moreOpen)}
			>
				Más filtros{advancedActive ? ` (${advancedActive})` : ''}
				<span aria-hidden="true">{moreOpen ? '▴' : '▾'}</span>
			</button>
		{/if}
		<!-- How many, out of all: «1 de 5 películas» with filters or a search. -->
		<span class="text-sm text-zinc-400 sm:ml-auto" aria-live="polite">
			{shown.length === data.movies.length
				? `${data.movies.length} ${data.movies.length === 1 ? 'película' : 'películas'}`
				: `${shown.length} de ${data.movies.length} películas`}
		</span>
		<select
			aria-label="Ordenar"
			class={dropdown}
			value={sort}
			onchange={(e) => choose('orden', e.currentTarget.value)}
		>
			{#each Object.entries(SORTS) as [value, label] (value)}
				<option {value}>{label}</option>
			{/each}
		</select>
	</div>
	{#if hasAdvanced && moreOpen}
		<div id="more-filters" class="mb-4 flex flex-wrap items-center gap-2">
			{#if decades.length > 1}
				<select
					aria-label="Década"
					class={dropdown}
					value={chosen('decada')}
					onchange={(e) => choose('decada', e.currentTarget.value)}
				>
					<option value="">Cualquier década</option>
					{#each decades as decade (decade)}
						<option value={String(decade)}>{filterLabel('decada', String(decade))}</option>
					{/each}
				</select>
			{/if}
			{#if awardFamilies.length}
				<select
					aria-label="Premios"
					class="{dropdown} max-w-48"
					value={chosen('premio')}
					onchange={(e) => choose('premio', e.currentTarget.value)}
				>
					<option value="">Con o sin premios</option>
					<option value="*">Con algún premio</option>
					{#each awardFamilies as { family, count } (family)}
						<option value={family}>{family} ({count})</option>
					{/each}
				</select>
			{/if}
			{#if sagas.length}
				<select
					aria-label="Saga"
					class="{dropdown} max-w-48"
					value={chosen('saga')}
					onchange={(e) => choose('saga', e.currentTarget.value)}
				>
					<option value="">Cualquier saga</option>
					{#each sagas as saga (saga)}
						<option value={saga}>{saga}</option>
					{/each}
				</select>
			{/if}
			{#if kinds.bn || kinds.muda}
				<select
					aria-label="Tipo"
					class={dropdown}
					value={chosen('tipo')}
					onchange={(e) => choose('tipo', e.currentTarget.value)}
				>
					<option value="">Color o no</option>
					{#if kinds.bn}<option value="bn">En blanco y negro</option>{/if}
					{#if kinds.muda}<option value="muda">Muda</option>{/if}
				</select>
			{/if}
		</div>
	{/if}
{/if}

{#if data.extras.total}
	<p class="mb-4 text-sm text-zinc-400">
		Completando las fichas con premios, sagas, guion, música y fotografía: {data.extras.done} de
		{data.extras.total}.
	</p>
{/if}

{#if data.withoutInfo}
	<p class="mb-4 text-sm text-zinc-400">
		{data.withoutInfo === 1 ? 'Hay 1 película' : `Hay ${data.withoutInfo} películas`} sin ficha: hasta
		que la tengan no se pueden buscar por director ni actor. Se buscan después de escanear, en segundo
		plano, o al abrir cada una.
	</p>
{/if}
{#if filters.length}
	<div class="mb-4 flex flex-wrap gap-2">
		{#each filters as filter, i (`${filter.name}=${filter.value}`)}
			<a
				href={withoutFilter(i)}
				class="rounded-full bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700"
				aria-label="Quitar el filtro {FILTERS[filter.name].label}: {filterLabel(
					filter.name,
					filter.value
				)}"
			>
				<span class="text-zinc-400">{FILTERS[filter.name].label}:</span>
				{filterLabel(filter.name, filter.value)} ✕
			</a>
		{/each}
	</div>
{/if}

{#if data.movies.length === 0}
	<p class="text-zinc-400">No hay películas todavía. Pulsa «Escanear carpeta».</p>
{:else if shown.length === 0}
	<p class="text-zinc-400">
		{search.trim()
			? `Ninguna película coincide con «${search.trim()}».`
			: 'Ninguna película con ese filtro.'}
	</p>
{:else}
	<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
		{#each shown as movie (movie.id)}
			<li class="min-w-0">
				<a
					href="/cine/{movie.id}"
					class="relative block aspect-video overflow-hidden rounded-md bg-zinc-800 hover:opacity-80"
				>
					{#if movie.status === 'ready'}
						<img
							src="/api/movie-thumb/{movie.id}"
							alt=""
							class="h-full w-full object-cover"
							loading="lazy"
						/>
						{#if movie.infoStatus === 'ambiguous' || movie.infoStatus === 'not_found'}
							<span
								class="absolute top-1 right-1 rounded bg-zinc-950/80 px-1.5 py-0.5 text-xs text-zinc-300"
								>{movie.infoStatus === 'ambiguous' ? 'Elegir ficha' : 'Sin ficha'}</span
							>
						{/if}
						{#if movie.completed}
							<span
								class="absolute top-1 left-1 rounded bg-zinc-950/80 px-1.5 py-0.5 text-xs font-medium text-amber-400"
								>✓ Vista</span
							>
						{:else if movie.positionSec && movie.durationSec}
							<div class="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
								<div
									class="h-full bg-amber-400"
									style:width="{(movie.positionSec / movie.durationSec) * 100}%"
								></div>
							</div>
						{/if}
					{:else}
						<p
							class={[
								'flex h-full items-center justify-center p-2 text-center text-xs',
								movie.status === 'error' ? 'text-red-400' : 'text-zinc-400'
							]}
						>
							{movie.status === 'error' ? 'No se pudo catalogar' : 'Catalogando…'}
						</p>
					{/if}
				</a>
				{#if editing === movie.id}
					<div class="mt-1 flex">
						<TitleForm
							action="?/rename"
							value={movie.title}
							placeholder={movie.autoTitle}
							hidden={{ id: movie.id }}
							onclose={() => (editing = null)}
						/>
					</div>
				{:else}
					<div class="mt-1 flex items-start gap-1">
						<div class="min-w-0 flex-1">
							<a
								href="/cine/{movie.id}"
								class="block truncate text-sm hover:text-amber-400"
								title={movie.title}>{movie.title}</a
							>
							<p class="text-xs text-zinc-400">
								{[movie.year, formatDuration(movie.durationSec)].filter(Boolean).join(' · ') || ' '}
							</p>
							{#if movie.reason}
								<p class="truncate text-xs text-amber-400" title={movie.reason}>{movie.reason}</p>
							{/if}
						</div>
						<MovieMenu {movie} mpv={data.mpv} onrename={() => (editing = movie.id)} />
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
