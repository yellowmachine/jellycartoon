<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import type { ActionData, PageData } from './$types';

	/**
	 * «Tu música» (#534): the bucket (S3, R2, Backblaze…) where the family keeps its music, for
	 * Música → Tu música. It can be the same as the files' (Espacio), with another folder. Read-only
	 * keys are enough, and better: Seilide only lists and reads.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const source = $derived(data.ownMusic);
	const problem = $derived(form && 'ownMusicProblem' in form ? form.ownMusicProblem : null);
	const ok = $derived(form && 'ownMusicOk' in form ? form.ownMusicOk : null);
	let editing = $state(false);
	let busy = $state(false);
	const when = (d: Date) =>
		d.toLocaleString('es-ES', {
			day: 'numeric',
			month: 'long',
			hour: '2-digit',
			minute: '2-digit'
		});

	// Reading the bucket: how far, every few seconds.
	$effect(() => {
		if (!source?.scanning) return;
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
			if (result.type === 'success') editing = false;
		};
	};
</script>

{#if data.family?.admin}
	<section class={section} id="tu-musica">
		<h2 class="mb-1 font-semibold">Tu música</h2>
		<p class="mb-4 text-sm text-zinc-400">
			La música que tengáis en vuestro propio almacenamiento (S3, R2, Backblaze…), en Música → Tu
			música, para toda la familia. Seilide solo la lee: no la copia ni la sube a ningún sitio.
		</p>

		{#if source}
			<p class="mb-1 text-sm">En <span class="text-zinc-200">{source.label}</span></p>
			{#if source.scanning}
				<p class="mb-3 text-sm text-zinc-400" role="status">
					Buscando… {source.total ? `${source.done} de ${source.total}` : ''}
				</p>
			{:else}
				<p class="mb-3 text-sm text-zinc-400">
					{source.tracks.toLocaleString('es-ES')} canciones{source.indexedAt
						? `, leídas el ${when(source.indexedAt)}`
						: ''}. Se vuelve a mirar cada día.
				</p>
			{/if}
			{#if source.problem}
				<p class="mb-3 text-sm text-amber-400">{source.problem}</p>
			{/if}
			{#if source.canWrite}
				<p class="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
					Estas claves también pueden escribir y borrar. Seilide no lo hace, pero es más seguro unas
					de solo lectura.
				</p>
			{/if}
			<div class="flex flex-wrap gap-2">
				<form method="post" action="?seccion={tab}&/ownMusicIndex" use:enhance={submit}>
					<button class={secondary} disabled={busy || source.scanning}>Volver a buscar</button>
				</form>
				<button class={secondary} onclick={() => (editing = !editing)}>Cambiar</button>
				<form method="post" action="?seccion={tab}&/ownMusicRemove" use:enhance={submit}>
					<button class={secondary} disabled={busy}>Quitar</button>
				</form>
			</div>
		{/if}

		{#if !source || editing}
			<form
				method="post"
				action="?seccion={tab}&/ownMusicSave"
				use:enhance={submit}
				class="mt-4 space-y-3"
			>
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
					Carpeta de la música dentro del bucket
					<input
						name="prefix"
						class={field}
						placeholder="musica/ (vacío: todo el bucket)"
						autocomplete="off"
					/>
				</label>
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
				<p class="text-xs text-zinc-500">
					Mejor unas claves de solo lectura para ese bucket. Se comprueba al guardar. Solo para
					música que tengáis derecho a escuchar, y para la familia.
				</p>
				<button class={primary} disabled={busy}>{busy ? 'Comprobando…' : 'Guardar'}</button>
			</form>
		{/if}

		{#if problem}
			<p class="mt-3 text-sm text-red-400">{problem}</p>
		{:else if ok}
			<p class="mt-3 text-sm text-emerald-400">{ok}</p>
		{/if}
	</section>
{/if}
