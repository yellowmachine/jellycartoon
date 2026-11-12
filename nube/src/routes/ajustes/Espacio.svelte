<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import { sizeText } from '#lib/storage-size.ts';
	import type { ActionData, PageData } from './$types';

	/**
	 * How much the family keeps (#480): its photos, voice notes, tickets, papers… In Seilide's
	 * storage, with its quota; full, nothing more can be kept until something goes. Or in its own S3
	 * or R2 (phase 2), without quota: its administrator moves them there, for good, and can move them
	 * on to another of its own or give it other keys.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const AREAS: Record<string, string> = {
		paseos: 'Fotos de paseos',
		fotos: 'Fotos de viajes',
		notas: 'Notas de voz',
		gastos: 'Tickets y facturas',
		ingresos: 'Ingresos',
		papeles: 'Papeles',
		oracion: 'Oraciones'
	};
	const use = $derived(data.storage);
	const place = $derived(data.storagePlace);
	const own = $derived(place?.state === 'externo');
	const share = $derived(use && !own ? Math.min(1, use.used / use.limit) : 0);
	const admin = $derived(Boolean(place?.admin));
	const problem = $derived(form && 'storageProblem' in form ? form.storageProblem : null);
	const ok = $derived(form && 'storageOk' in form ? form.storageOk : null);
	/** Which form is open: to its own storage, to another, or other keys. */
	let open = $state<'pasar' | 'claves' | 'seguir' | null>(null);
	let busy = $state(false);
	const day = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

	// While moving, how far it goes, every few seconds.
	$effect(() => {
		if (place?.state !== 'pasando' || place.problem) return;
		const every = setInterval(() => void invalidateAll(), 3000);
		return () => clearInterval(every);
	});

	const submit = () => {
		busy = true;
		return async ({
			update,
			result
		}: {
			update: () => Promise<void>;
			result: { type: string };
		}) => {
			await update();
			busy = false;
			if (result.type === 'success' && open !== null) open = null;
		};
	};
</script>

{#snippet bucketFields(withPlace: boolean)}
	{#if withPlace}
		<label class="block text-sm">
			Dirección (endpoint)
			<input
				name="endpoint"
				class={field}
				required
				placeholder="https://<cuenta>.r2.cloudflarestorage.com"
				autocomplete="off"
			/>
		</label>
		<div class="grid grid-cols-2 gap-3">
			<label class="block text-sm">
				Bucket
				<input name="bucket" class={field} required autocomplete="off" />
			</label>
			<label class="block text-sm">
				Región
				<input name="region" class={field} placeholder="auto" autocomplete="off" />
			</label>
		</div>
		<label class="block text-sm">
			Carpeta dentro del bucket
			<input name="prefix" class={field} value="seilide/" autocomplete="off" />
		</label>
	{/if}
	<label class="block text-sm">
		Clave de acceso (Access Key ID)
		<input name="accessKeyId" class={field} required autocomplete="off" />
	</label>
	<label class="block text-sm">
		Clave secreta (Secret Access Key)
		<input
			name="secretAccessKey"
			type="password"
			class={field}
			required
			autocomplete="new-password"
		/>
	</label>
{/snippet}

{#if use}
	<section class={section} id="espacio">
		<h2 class="mb-1 font-semibold">Espacio</h2>
		{#if own}
			<p class="mb-4 text-sm text-zinc-400">
				Los ficheros de la familia (fotos, notas de voz, tickets, papeles…) están en vuestro propio
				almacenamiento: <span class="text-zinc-200">{place?.label}</span>. Sin límite de Seilide.
			</p>
			<p class="mb-3 text-sm text-zinc-300">{sizeText(use.used)} guardados</p>
		{:else}
			<p class="mb-4 text-sm text-zinc-400">
				Lo que la familia guarda en Seilide: fotos, notas de voz, tickets, papeles… Cuando se llena,
				no se puede guardar nada nuevo hasta que se borre algo.
			</p>
			<div
				class="mb-2 h-3 overflow-hidden rounded-full bg-zinc-800"
				role="meter"
				aria-label="Espacio usado"
				aria-valuemin={0}
				aria-valuemax={use.limit}
				aria-valuenow={use.used}
			>
				<div
					class="h-full rounded-full {share >= 1
						? 'bg-red-500'
						: share >= 0.8
							? 'bg-amber-400'
							: 'bg-emerald-500'}"
					style="width: {Math.max(share * 100, use.used ? 1 : 0)}%"
				></div>
			</div>
			<p class="mb-3 text-sm {share >= 1 ? 'text-red-400' : 'text-zinc-300'}">
				{sizeText(use.used)} de {sizeText(use.limit)}{share >= 1 ? ': lleno' : ''}
			</p>
		{/if}
		{#if use.areas.length}
			<ul class="mb-4 space-y-1 text-sm text-zinc-400">
				{#each use.areas as a (a.area)}
					<li class="flex justify-between gap-3">
						<span>{AREAS[a.area] ?? a.area}</span>
						<span class="tabular-nums">{sizeText(a.bytes)}</span>
					</li>
				{/each}
			</ul>
		{/if}

		{#if place?.state === 'pasando'}
			<div class="mb-3 rounded-md border border-zinc-700 p-3">
				<p class="mb-2 text-sm">
					Pasando los ficheros a <span class="text-zinc-200">{place.nextLabel}</span>:
					{place.done} de {place.total}
				</p>
				<div class="mb-2 h-2 overflow-hidden rounded-full bg-zinc-800">
					<div
						class="h-full rounded-full bg-sky-500"
						style="width: {place.total ? (place.done / place.total) * 100 : 0}%"
					></div>
				</div>
				{#if place.problem}
					<p class="mb-2 text-sm text-red-400">Se ha parado: {place.problem}.</p>
				{:else}
					<p class="text-xs text-zinc-500">
						Mientras tanto todo funciona como siempre. Si se corta, sigue solo desde donde iba.
					</p>
				{/if}
				{#if admin}
					<div class="mt-2 flex flex-wrap gap-2">
						{#if place.problem}
							<form method="post" action="?seccion={tab}&/storageContinue" use:enhance={submit}>
								<button class={primary} disabled={busy}>Seguir</button>
							</form>
							<button class={secondary} onclick={() => (open = open === 'seguir' ? null : 'seguir')}
								>Seguir con otras claves</button
							>
						{/if}
						<form method="post" action="?seccion={tab}&/storageCancel" use:enhance={submit}>
							<button class={secondary} disabled={busy}>Cancelar</button>
						</form>
					</div>
					{#if open === 'seguir'}
						<form
							method="post"
							action="?seccion={tab}&/storageContinue"
							use:enhance={submit}
							class="mt-3 space-y-3"
						>
							<p class="text-xs text-zinc-500">
								El mismo almacenamiento ({place.nextLabel}), con otras claves.
							</p>
							{@render bucketFields(true)}
							<button class={primary} disabled={busy}>Seguir</button>
						</form>
					{/if}
				{/if}
			</div>
		{/if}

		{#if own && place?.cleanupAt}
			<p class="mb-3 text-xs text-zinc-500">
				Seilide guarda una copia de los ficheros de antes hasta el {day(place.cleanupAt)}, por si
				acaso.
			</p>
		{/if}

		{#if admin && place?.state !== 'pasando'}
			<div class="flex flex-wrap gap-2">
				<button class={secondary} onclick={() => (open = open === 'pasar' ? null : 'pasar')}>
					{own ? 'Pasar a otro almacenamiento' : 'Usar vuestro propio almacenamiento'}
				</button>
				{#if own}
					<button class={secondary} onclick={() => (open = open === 'claves' ? null : 'claves')}
						>Cambiar las claves</button
					>
				{/if}
			</div>

			{#if open === 'pasar'}
				<form
					method="post"
					action="?seccion={tab}&/storageMove"
					use:enhance={submit}
					class="mt-4 space-y-3"
				>
					<p class="text-sm text-zinc-400">
						Un S3 vuestro (Cloudflare R2, Backblaze B2, AWS, Scaleway, un MinIO…): lo pagáis
						vosotros y no hay límite de Seilide. Las claves necesitan poder leer, escribir, listar y
						borrar en esa carpeta; se guardan cifradas.
					</p>
					{@render bucketFields(true)}
					{#if !own}
						<p
							class="rounded-md border border-amber-800 bg-amber-950/40 p-2 text-sm text-amber-200"
						>
							No hay vuelta atrás: una vez en vuestro almacenamiento, los ficheros ya no vuelven a
							Seilide (sí podéis pasarlos a otro vuestro). Si vuestro almacenamiento falla, no se
							verán hasta que lo arregléis. Si un día borráis la familia, lo que haya en él no se
							toca.
						</p>
					{/if}
					<label class="flex items-start gap-2 text-sm">
						<input type="checkbox" name="confirm" class="mt-1" required />
						{own
							? 'Pasar los ficheros a este otro almacenamiento'
							: 'Lo entiendo: pasar los ficheros para siempre'}
					</label>
					<div class="flex flex-wrap gap-2">
						<button
							class={secondary}
							formaction="?seccion={tab}&/storageTest"
							formnovalidate
							disabled={busy}>Probar</button
						>
						<button class={primary} disabled={busy}>Probar y pasar los ficheros</button>
					</div>
				</form>
			{/if}

			{#if open === 'claves'}
				<form
					method="post"
					action="?seccion={tab}&/storageKeys"
					use:enhance={submit}
					class="mt-4 space-y-3"
				>
					<p class="text-sm text-zinc-400">
						El mismo almacenamiento ({place?.label}), con otras claves. No se mueve nada.
					</p>
					{@render bucketFields(true)}
					<button class={primary} disabled={busy}>Probar y cambiar</button>
				</form>
			{/if}
		{/if}

		{#if problem}
			<p class="mt-3 text-sm text-red-400">{problem}</p>
		{:else if ok}
			<p class="mt-3 text-sm text-emerald-400">{ok}</p>
		{/if}
	</section>
{/if}
