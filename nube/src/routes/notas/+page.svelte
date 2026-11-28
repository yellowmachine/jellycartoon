<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import NoteButton from '#lib/components/NoteButton.svelte';
	import NoteIcon from '#lib/components/NoteIcon.svelte';
	import NoteRead from './NoteRead.svelte';
	import WalkUploads from '#lib/components/WalkUploads.svelte';
	import { noteRecorder } from '#lib/note-recorder.svelte.ts';
	import { herePosition, shrinkPhoto } from '#lib/mensajes/photo.ts';
	import {
		MAX_NOTE_TEXT,
		MAX_NOTE_TAGS,
		notesAndPhotos,
		onlyLink,
		photoMoment,
		type Note,
		type NoteKind,
		type TextOnly
	} from '#lib/notes.ts';
	import { photoTaken } from '#lib/photo-taken.ts';
	import { keepAttachment } from '#lib/walk-attachments.ts';
	import { walkUploads } from '#lib/walk-uploads.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * Notas (#416): what is dictated, recorded here or on a walk, or said to the voice. Heard by
	 * itself; the text can be corrected, and the recording is still there to listen to. By tabs:
	 * said, with a photo, and Textos, written and webs to read (#634), each with its own way of
	 * making one; Textos as cards, each read whole in the tab itself (`?ver=`, 2026-11-28). What is
	 * made in a tab stays in it: the forms post to the page as it is, tab and filters too.
	 */
	let { data, form }: PageProps = $props();

	const when = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });
	const SOURCE = { pagina: 'Grabada', paseo: 'En un paseo', voz: 'Por voz', escrita: 'Escrita' };

	let editing = $state<number | null>(null);
	let deleting = $state<number | null>(null);
	let problem = $state<string | null>(null);

	/** The photo of the note being written, already small, and to see it. */
	let photo = $state<Blob | null>(null);
	let photoUrl = $state<string | null>(null);
	let saving = $state(false);
	/** When and where that photo was taken (#613): just now and here, or as its file says. */
	let takenAt = $state<Date | null>(null);
	let takenHere = $state<[number, number] | null>(null);
	let placed = $state(true);
	/** The photo open, big. */
	let open = $state<{ src: string; alt: string } | null>(null);
	let deletingPhoto = $state<number | null>(null);

	/** Where this device is, if it knows and may say it: never in the way of a note. */
	const here = () =>
		herePosition()
			.then((p): [number, number] => [p.lon, p.lat])
			.catch(() => null);

	const TABS: { kind: NoteKind; label: string }[] = [
		{ kind: 'voz', label: 'Voz' },
		{ kind: 'foto', label: 'Foto' },
		{ kind: 'texto', label: 'Textos' }
	];
	const ONLY: { only: TextOnly; label: string }[] = [
		{ only: null, label: 'Todo' },
		{ only: 'notas', label: 'Notas' },
		{ only: 'leer', label: 'Para leer' }
	];

	/**
	 * This page with what is chosen now, but for what changes; without the search (#634), nor the
	 * note read whole unless said (`ver`). Another tab, without Textos' «solo».
	 */
	const link = (change: {
		kind?: NoteKind;
		casa?: boolean;
		etiqueta?: string | null;
		solo?: TextOnly;
		ver?: number | null;
		q?: string | null;
	}) => {
		const kind = change.kind ?? data.kind;
		const only = change.solo !== undefined ? change.solo : kind === data.kind ? data.only : null;
		const params = new URLSearchParams();
		if (kind !== 'voz') params.set(kind, '');
		if (kind === 'texto' && only) params.set('solo', only);
		if (change.casa ?? data.house) params.set('casa', '');
		const tag = change.etiqueta === undefined ? data.tag : change.etiqueta;
		if (tag) params.set('etiqueta', tag);
		if (change.q) params.set('q', change.q);
		if (change.ver) params.set('ver', String(change.ver));
		const query = `${params}`.replace(/=(&|$)/g, '$1');
		return query ? `/notas?${query}` : '/notas';
	};
	/** The list as it is, search too: where a note read whole goes back to. */
	const list = $derived(link({ q: data.q }));
	/**
	 * A form's action on this page as it is (tab, filters, search, the note read whole), so that
	 * after it, also without JavaScript, it stays where it was; `back`, the list instead.
	 */
	const act = (name: string, back = false) => {
		const here = back ? list : link({ q: data.q, ver: data.seen?.note.id ?? null });
		return `${here}${here.includes('?') ? '&' : '?'}/${name}`;
	};
	/** The form for a note written by hand: always in Textos, and with the photo just picked. */
	const writing = $derived(data.kind === 'texto' || (data.kind === 'foto' && photo !== null));
	/** What is being written in Textos: only a web's address is saved to read. */
	let draft = $state('');
	const isLink = $derived(!photo && onlyLink(draft) !== null);
	const EMPTY: Record<NoteKind, string> = {
		voz: 'Todavía no hay notas dichas.',
		foto: 'Todavía no hay notas con foto.',
		texto: 'Todavía no hay textos: escribe una nota o pega el enlace de una web.'
	};
	const EMPTY_ONLY = {
		notas: 'Todavía no hay notas escritas.',
		leer: 'Nada guardado para leer todavía.'
	};
	/** A card's first line: what it is, when, whose. */
	const about = (n: Note) =>
		`${n.link ? 'Para leer' : 'Nota'} · ${when.format(new Date(n.at))}${n.author ? ` · de ${n.author}` : ''}${n.shared ? ' · para toda la casa' : ''}`;
	const hostOf = (link: string) => new URL(link).hostname.replace(/^www\./, '');
	/** Textos as cards; the search, as the other tabs, a list. */
	const cards = $derived(data.kind === 'texto' && !data.q);
	const chip = (on: boolean) =>
		on ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white';

	const items = $derived(
		notesAndPhotos(data.notes, data.photos, (d) => d.toLocaleDateString('sv'))
	);

	$effect(() => {
		if (!photo) return;
		const url = URL.createObjectURL(photo);
		photoUrl = url;
		return () => {
			URL.revokeObjectURL(url);
			photoUrl = null;
		};
	});

	async function picked(input: HTMLInputElement, camera: boolean) {
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		problem = null;
		try {
			const now = new Date();
			// Read before it is made small: that leaves it out.
			const taken = photoTaken(await file.arrayBuffer());
			photo = (await shrinkPhoto(file)).blob;
			placed = true;
			takenAt = camera ? now : taken.at && photoMoment(taken.at.getTime());
			takenHere = camera ? null : taken.position;
			if (camera) {
				const mine = photo;
				void here().then((p) => {
					// Not another photo's, taken meanwhile.
					if (photo === mine) takenHere = p;
				});
			}
		} catch (err) {
			problem = (err as Error).message;
		}
	}

	function stopWriting() {
		photo = null;
		takenAt = takenHere = null;
	}

	// What a walk going on or not sent yet took, it sends itself afterwards.
	const send = () => walkUploads.send(data.user!.id);

	onMount(() => void walkUploads.look(data.user!.id));

	/** Where the note being recorded is: asked as it starts, so keeping it waits for nothing. */
	let recordedHere: [number, number] | null = null;
	$effect(() => {
		if (!noteRecorder.recording) return;
		recordedHere = null;
		let current = true;
		void here().then((p) => {
			if (current) recordedHere = p;
		});
		return () => (current = false);
	});

	async function recorded(audio: Blob) {
		problem = null;
		const position = recordedHere;
		try {
			await keepAttachment({
				userId: data.user!.id,
				kind: 'nota',
				blob: audio,
				at: Date.now(),
				position,
				walk: null
			});
		} catch {
			problem = 'No se ha podido guardar en este móvil.';
			return;
		}
		await send();
	}
</script>

<svelte:head>
	<title>Notas · Seilide</title>
</svelte:head>

{#snippet pick(text: string, camera: boolean)}
	<label
		class={[
			'inline-flex cursor-pointer items-center gap-2 rounded-md px-4 py-2 focus-within:ring-2 focus-within:ring-amber-300',
			camera ? 'bg-amber-500 font-semibold text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700',
			saving && 'pointer-events-none opacity-50'
		]}
	>
		<NoteIcon name={camera ? 'foto' : 'galeria'} class="h-5 w-5" />{text}
		<input
			type="file"
			accept="image/*"
			capture={camera ? 'environment' : undefined}
			class="sr-only"
			disabled={saving}
			onchange={(e) => picked(e.currentTarget, camera)}
		/>
	</label>
{/snippet}

<h1 class="mb-1 text-2xl font-bold">Notas</h1>
<p class="mb-4 text-sm text-zinc-400">
	Lo que dices, fotografías o escribes, y las webs para leer luego. Solo para ti, si no la compartes
	con la casa; las dichas a un altavoz, para todos.
</p>

<!-- As PaseosTabs. -->
<nav
	class="mb-4 flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0] shadow-zinc-800"
	aria-label="Qué notas"
>
	{#each TABS as t (t.kind)}
		{@const on = t.kind === data.kind && !data.q}
		<a
			href={link({ kind: t.kind })}
			aria-current={on ? 'page' : undefined}
			class={[
				'inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-2 text-sm',
				on
					? 'border-amber-500 font-semibold text-white'
					: 'border-transparent text-zinc-400 hover:text-white'
			]}><NoteIcon name={t.kind} />{t.label}</a
		>
	{/each}
</nav>

<datalist id="etiquetas">
	{#each data.tags as t (t)}<option value={t}></option>{/each}
</datalist>

{#if data.seen}
	{@const title = data.seen.article?.title || data.seen.note.text}
	<nav aria-label="Ruta" class="mb-4 flex min-w-0 items-center gap-1.5 text-sm">
		<a href={list} class="shrink-0 text-amber-400 hover:underline"
			>{data.q ? `Buscando «${data.q}»` : TABS.find((t) => t.kind === data.kind)?.label}</a
		>
		<span class="text-zinc-600" aria-hidden="true">›</span>
		<span class="truncate text-zinc-300" aria-current="page">{title.split('\n')[0]}</span>
	</nav>
	{#if form?.message}
		<p class="mb-4 text-sm text-red-400" role="alert">{form.message}</p>
	{/if}
	{#key data.seen.note.id}
		<NoteRead
			note={data.seen.note}
			article={data.seen.article}
			justSaved={data.seen.justSaved}
			{act}
			back={list}
		/>
	{/key}
{:else}
	{#if data.kind === 'voz'}
		<div class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
			<NoteButton
				onrecorded={recorded}
				class="rounded-md bg-amber-500 px-4 py-2 font-semibold text-zinc-950"
			/>
			<p class="text-sm text-zinc-400">
				Graba aquí, en un paseo o dile a la voz «toma nota»: se escribe sola.
			</p>
		</div>
	{:else if data.kind === 'foto' && !photo}
		<div class="mb-4 flex flex-wrap items-center gap-3">
			{@render pick('Hacer una foto', true)}
			{@render pick('Elegir una foto', false)}
		</div>
	{/if}
	{#if writing}
		<form
			method="post"
			action={act('write')}
			enctype="multipart/form-data"
			class="mb-4"
			use:enhance={({ formData }) => {
				if (photo) {
					formData.set('photo', photo, 'foto.jpg');
					if (takenAt) formData.set('at', String(takenAt.getTime()));
					if (takenHere && placed) {
						formData.set('lon', String(takenHere[0]));
						formData.set('lat', String(takenHere[1]));
					}
				}
				saving = true;
				problem = null;
				return async ({ result, update }) => {
					saving = false;
					// Without coverage: what is written stays here, to try again.
					if (result.type === 'error') {
						problem = 'No se ha podido guardar. Prueba otra vez.';
						return;
					}
					await update();
					if (result.type === 'success') {
						stopWriting();
						draft = '';
					}
				};
			}}
		>
			{#if photoUrl}
				<div class="mb-2 flex items-end gap-3">
					<img src={photoUrl} alt="Foto de la nota" class="max-h-48 rounded-md" />
					<button type="button" class="text-sm text-zinc-400 hover:text-white" onclick={stopWriting}
						>Quitar la foto</button
					>
				</div>
			{/if}
			<!-- svelte-ignore a11y_autofocus -->
			<textarea
				name="text"
				rows="3"
				required={!photo}
				autofocus={photo !== null}
				maxlength={MAX_NOTE_TEXT}
				aria-label="Nota"
				bind:value={draft}
				placeholder={photo
					? 'Qué es (para encontrarla luego)'
					: 'Escribe una nota o pega el enlace de una web'}
				class="mb-2 w-full rounded-md border-zinc-700 bg-zinc-950 text-sm focus:border-amber-500 focus:ring-amber-500"
			></textarea>
			{#if photo && takenAt}
				<p class="mb-2 text-xs text-zinc-400">
					Se guarda con la hora de la foto: {when.format(takenAt)}.
				</p>
			{/if}
			{#if photo && takenHere}
				<label class="mb-2 flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						bind:checked={placed}
						class="rounded border-zinc-600 bg-zinc-950 text-amber-500"
					/>
					<NoteIcon name="lugar" class="h-4 w-4 text-zinc-400" />Guardar dónde se hizo (solo lo ves
					tú)
				</label>
			{/if}
			<input
				name="tags"
				list="etiquetas"
				placeholder="Etiquetas: cocina, niños…"
				aria-label="Etiquetas, separadas por comas (hasta {MAX_NOTE_TAGS})"
				class="mb-2 w-full rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500"
			/>
			<div class="flex flex-wrap items-center gap-3 text-sm">
				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						name="shared"
						checked={data.house}
						class="rounded border-zinc-600 bg-zinc-950 text-amber-500"
					/>
					Para toda la casa
				</label>
				<button
					class="rounded-md bg-amber-500 px-3 py-1 font-medium text-zinc-950 disabled:opacity-50"
					disabled={saving}
					>{saving ? (isLink ? 'Leyendo la web…' : 'Guardando…') : 'Guardar'}</button
				>
				{#if photo}
					<button type="button" class="text-zinc-400" onclick={stopWriting}>Cancelar</button>
				{/if}
			</div>
			{#if !photo}
				<p class="mt-2 text-xs text-zinc-500">
					{isLink
						? 'Es un enlace: se guarda la web para leerla luego, limpia, como en el modo lectura del navegador (el texto, sin anuncios ni fotos).'
						: 'Si pegas solo el enlace de una web, se guarda para leerla luego. También desde el marcador «A Seilide» o compartiendo el enlace con Seilide en el móvil.'}
				</p>
			{/if}
		</form>
		{#if form && 'saved' in form && form.saved}
			<p class="mb-4 text-sm text-emerald-300" role="status">{form.saved}</p>
		{/if}
	{/if}
	<WalkUploads />
	{#if noteRecorder.problem || problem}
		<p class="mb-4 text-sm text-amber-300" role="alert">{noteRecorder.problem ?? problem}</p>
	{/if}
	{#if form?.message}
		<p class="mb-4 text-sm text-red-400" role="alert">{form.message}</p>
	{/if}

	<form method="get" class="mb-3 flex gap-2">
		{#if data.kind !== 'voz'}<input type="hidden" name={data.kind} value="" />{/if}
		{#if data.kind === 'texto' && data.only}<input
				type="hidden"
				name="solo"
				value={data.only}
			/>{/if}
		{#if data.house}<input type="hidden" name="casa" value="" />{/if}
		{#if data.tag}<input type="hidden" name="etiqueta" value={data.tag} />{/if}
		<input
			name="q"
			type="search"
			value={data.q ?? ''}
			placeholder="Buscar en todas las notas"
			class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500"
		/>
		<button class="rounded-md bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">Buscar</button>
	</form>
	{#if data.q}
		<p class="mb-3 text-sm text-zinc-400">
			Buscando «{data.q}» en todas las notas ·
			<a href={link({})} class="text-amber-400 hover:underline">Quitar la búsqueda</a>
		</p>
	{/if}
	<nav class="mb-4 flex flex-wrap gap-2 text-xs" aria-label="Filtros">
		{#if cards}
			{#each ONLY as o (o.label)}
				<a
					href={link({ solo: o.only })}
					aria-current={data.only === o.only ? 'page' : undefined}
					class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 {chip(
						data.only === o.only
					)}"
					>{#if o.only}<NoteIcon
							name={o.only === 'leer' ? 'leer' : 'texto'}
							class="h-3.5 w-3.5"
						/>{/if}{o.label}</a
				>
			{/each}
			<span class="w-px bg-zinc-800" aria-hidden="true"></span>
		{/if}
		<a
			href={link({ casa: !data.house })}
			aria-current={data.house ? 'page' : undefined}
			class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 {chip(data.house)}"
			><NoteIcon name="casa" class="h-3.5 w-3.5" />Solo de la casa</a
		>
		{#if data.tags.length}
			<a href={link({ etiqueta: null })} class="rounded-full px-2.5 py-1 {chip(!data.tag)}"
				>Todas las etiquetas</a
			>
			{#each data.tags as t (t)}
				<a
					href={link({ etiqueta: t })}
					aria-current={data.tag === t ? 'page' : undefined}
					class="rounded-full px-2.5 py-1 {chip(data.tag === t)}">#{t}</a
				>
			{/each}
		{/if}
	</nav>

	{#if cards && items.length}
		<ul class="grid gap-3">
			{#each items as item (item.key)}
				{#if 'note' in item}
					{@const n = item.note}
					<li>
						<a
							href={link({ ver: n.id })}
							class={[
								'block rounded-lg border p-4 transition-colors focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:outline-none',
								n.link
									? 'border-sky-500/30 bg-sky-950/30 hover:border-sky-400/60'
									: 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-600'
							]}
						>
							<p class="mb-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
								<NoteIcon
									name={n.link ? 'leer' : 'texto'}
									class="h-4 w-4 {n.link ? 'text-sky-400' : 'text-amber-400'}"
								/>
								<span class="truncate">{about(n)}</span>
								{#if n.link}
									<span
										class="ml-auto shrink-0 rounded-full border border-sky-500/30 px-2 py-0.5 text-sky-300"
										>Solo lectura</span
									>
								{/if}
							</p>
							{#if n.link}
								<p class="line-clamp-2 leading-snug font-semibold">{n.text}</p>
								<p class="mt-0.5 text-xs text-zinc-400">
									{n.article
										? `${n.article.site ?? hostOf(n.link)} · ${n.article.minutes} min`
										: `${hostOf(n.link)} · sin el texto: esa web no deja leerla desde Seilide`}
								</p>
								{#if n.article?.excerpt}
									<p class="mt-2 line-clamp-3 text-sm text-zinc-300">{n.article.excerpt}</p>
								{/if}
							{:else}
								<p class="line-clamp-4 break-words whitespace-pre-wrap">{n.text}</p>
							{/if}
							{#if n.tags.length}
								<p class="mt-2 flex flex-wrap gap-1.5 text-xs">
									{#each n.tags as t (t)}
										<span class="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300">#{t}</span>
									{/each}
								</p>
							{/if}
						</a>
					</li>
				{/if}
			{/each}
		</ul>
	{:else if items.length}
		<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
			{#each items as item (item.key)}
				{#if 'photos' in item}
					<li class="p-3">
						<p class="mb-1 text-xs text-zinc-500">
							{when.format(item.at)} · {item.photos.length === 1 ? 'Foto' : 'Fotos'} de un paseo
							{#if item.walkId !== null}·
								<a href="/paseos?paseo={item.walkId}" class="text-amber-400 hover:underline"
									>Ver el paseo</a
								>{:else}borrado{/if}
						</p>
						<ul class="flex flex-wrap gap-2">
							{#each item.photos as p (p.id)}
								<li class="flex flex-col items-center gap-1">
									<button
										type="button"
										aria-label="Ver la foto en grande"
										onclick={() => (open = { src: `/paseos/fotos/${p.id}`, alt: 'Foto del paseo' })}
									>
										<img
											src="/paseos/fotos/{p.id}"
											alt="Foto del paseo"
											loading="lazy"
											class="h-28 w-28 rounded-md object-cover"
										/>
									</button>
									{#if deletingPhoto === p.id}
										<form
											method="post"
											action={act('deletePhoto')}
											use:enhance
											class="flex gap-2 text-xs"
										>
											<input type="hidden" name="id" value={p.id} />
											<button class="text-red-400">Sí, borrarla</button>
											<button
												type="button"
												class="text-zinc-400"
												onclick={() => (deletingPhoto = null)}>No</button
											>
										</form>
									{:else}
										<button
											class="text-xs text-zinc-500 hover:text-red-400"
											onclick={() => (deletingPhoto = p.id)}>Borrar</button
										>
									{/if}
								</li>
							{/each}
						</ul>
					</li>
				{:else}
					{@const n = item.note}
					<li class="p-3">
						<p class="mb-1 text-xs text-zinc-500">
							{when.format(new Date(n.at))} · {n.link
								? 'Para leer'
								: n.photo && n.source === 'escrita'
									? 'Con foto'
									: SOURCE[n.source]}{n.author ? ` · de ${n.author}` : ''}{n.shared
								? ' · para toda la casa'
								: ''}{#if n.lon !== null}
								· <NoteIcon name="lugar" class="inline h-3.5 w-3.5 align-[-2px]" />{/if}
						</p>
						{#if editing === n.id}
							<form
								method="post"
								action={act('edit')}
								use:enhance={() =>
									async ({ update }) => {
										await update();
										editing = null;
									}}
							>
								<input type="hidden" name="id" value={n.id} />
								<textarea
									name="text"
									rows="3"
									required
									class="mb-2 w-full rounded-md border-zinc-700 bg-zinc-950 text-sm focus:border-amber-500 focus:ring-amber-500"
									>{n.text}</textarea
								>
								<input
									name="tags"
									list="etiquetas"
									value={n.tags.join(', ')}
									placeholder="Etiquetas: cocina, niños…"
									aria-label="Etiquetas, separadas por comas"
									class="mb-2 w-full rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500"
								/>
								<div class="flex gap-3 text-sm">
									<button class="rounded-md bg-amber-500 px-3 py-1 font-medium text-zinc-950"
										>Guardar</button
									>
									<button type="button" class="text-zinc-400" onclick={() => (editing = null)}
										>Cancelar</button
									>
								</div>
							</form>
						{:else if n.hearing === 'ready'}
							{#if n.text || !n.photo}
								<p class="break-words whitespace-pre-wrap">{n.text || '(sin palabras)'}</p>
							{/if}
						{:else if n.hearing === 'pending'}
							<p class="text-sm text-zinc-400">Transcribiendo…</p>
						{:else}
							<p class="text-sm text-amber-300">No se pudo transcribir.</p>
						{/if}
						{#if n.link && editing !== n.id}
							<p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
								{#if n.article}
									<a
										href={link({ kind: 'texto', ver: n.id, q: data.q })}
										class="inline-flex items-center gap-1.5 font-medium text-amber-400 hover:underline"
										><NoteIcon name="leer" />Leer</a
									>
									<span class="text-zinc-500"
										>{n.article.minutes} min{n.article.site ? ` · ${n.article.site}` : ''}</span
									>
								{:else}
									<span class="text-zinc-500"
										>Sin el texto: esa web no deja leerla desde Seilide</span
									>
								{/if}
								<a
									href={n.link}
									target="_blank"
									rel="noopener noreferrer"
									class="truncate text-zinc-400 hover:underline"
									>{new URL(n.link).hostname.replace(/^www\./, '')} ↗</a
								>
							</p>
						{/if}
						{#if n.tags.length && editing !== n.id}
							<p class="mt-1 flex flex-wrap gap-1.5 text-xs">
								{#each n.tags as t (t)}
									<a
										href={link({ etiqueta: t })}
										class="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300 hover:text-white"
										>#{t}</a
									>
								{/each}
							</p>
						{/if}
						{#if n.photo}
							<button
								type="button"
								class="mt-2 block"
								aria-label="Ver la foto en grande"
								onclick={() => (open = { src: n.photo!, alt: n.text || 'Foto' })}
							>
								<img
									src={n.photo}
									alt={n.text || 'Foto'}
									loading="lazy"
									class="max-h-48 max-w-full rounded-md"
								/>
							</button>
						{/if}
						{#if n.hasAudio}
							<audio controls preload="none" src="/notas/{n.id}/audio" class="mt-2 w-full"></audio>
						{/if}
						{#if editing !== n.id && n.canEdit}
							<div class="mt-2 flex flex-wrap items-center gap-3 text-sm">
								{#if n.hearing !== 'ready' && n.hasAudio && n.mine}
									<form method="post" action={act('hear')} use:enhance>
										<input type="hidden" name="id" value={n.id} />
										<button class="text-amber-400 hover:underline">Transcribir otra vez</button>
									</form>
								{/if}
								<button class="text-zinc-400 hover:text-white" onclick={() => (editing = n.id)}
									>Corregir</button
								>
								{#if n.mine}
									<form method="post" action={act('share')} use:enhance>
										<input type="hidden" name="id" value={n.id} />
										<input type="hidden" name="shared" value={n.shared ? '0' : '1'} />
										<button class="text-zinc-400 hover:text-white"
											>{n.shared ? 'Solo para mí' : 'Compartir con la casa'}</button
										>
									</form>
								{/if}
								{#if deleting === n.id}
									<form method="post" action={act('delete')} use:enhance class="flex gap-3">
										<input type="hidden" name="id" value={n.id} />
										<button class="text-red-400">Sí, borrarla</button>
										<button type="button" class="text-zinc-400" onclick={() => (deleting = null)}
											>No</button
										>
									</form>
								{:else}
									<button class="text-zinc-500 hover:text-red-400" onclick={() => (deleting = n.id)}
										>Borrar</button
									>
								{/if}
							</div>
						{/if}
					</li>
				{/if}
			{/each}
		</ul>
	{:else if data.q}
		<p class="text-zinc-400">Ninguna nota dice «{data.q}».</p>
	{:else}
		<p class="text-zinc-400">
			{data.tag
				? `Ninguna nota aquí con #${data.tag}.`
				: data.house
					? 'Aquí todavía no hay notas de toda la casa.'
					: data.kind === 'texto' && data.only
						? EMPTY_ONLY[data.only]
						: EMPTY[data.kind]}
		</p>
	{/if}
{/if}

{#if open}
	<dialog
		{@attach (el) => el.showModal()}
		onclose={() => (open = null)}
		onclick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
		aria-label="Foto"
		class="tema-oscuro m-auto max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/95"
	>
		<img src={open.src} alt={open.alt} class="max-h-[95dvh] max-w-[95vw] object-contain" />
		<form method="dialog">
			<button class="fixed top-3 right-3 rounded-full bg-zinc-800 px-4 py-2 text-white"
				>✕ Cerrar</button
			>
		</form>
	</dialog>
{/if}
