<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { field, primary, secondary, section } from '#lib/styles.ts';
	import type { ActionData, PageData } from './$types';

	/**
	 * «Tus juegos» (#564): the bucket (S3, R2, Backblaze…) where the family keeps its games, one
	 * folder per console, for Juegos (with the house, as each one chooses: game-source.ts). The
	 * same as Tu música's, with its own folder, at a touch. Read-only keys are enough, and better.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const source = $derived(data.ownGames);
	const problem = $derived(form && 'ownGamesProblem' in form ? form.ownGamesProblem : null);
	const ok = $derived(form && 'ownGamesOk' in form ? form.ownGamesOk : null);
	let editing = $state(false);
	let busy = $state(false);
	const when = (d: Date) =>
		d.toLocaleString('es-ES', {
			day: 'numeric',
			month: 'long',
			hour: '2-digit',
			minute: '2-digit'
		});

	// Listing the bucket: until it ends.
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
	<section class={section} id="tus-juegos">
		<h2 class="mb-1 font-semibold">Tus juegos</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Los juegos que tengáis en vuestro propio almacenamiento (S3, R2, Backblaze…), en Juegos, para
			los adultos de la familia; con casa también, cada uno elige en Para mí cuáles ve. Van en una
			carpeta por consola: <code>nes/</code>, <code>snes/</code>, <code>gb/</code>,
			<code>gbc/</code>, <code>gba/</code>, <code>mastersystem/</code>, <code>megadrive/</code>,
			<code>atari2600/</code>, y las recreativas en <code>arcade/</code>, los <code>.zip</code> con
			el nombre corto de FinalBurn Neo (<code>mslug.zip</code>) y su BIOS al lado (<code
				>neogeo.zip</code
			>).
		</p>

		{#if source}
			<p class="mb-1 text-sm">En <span class="text-zinc-200">{source.label}</span></p>
			{#if source.scanning}
				<p class="mb-3 text-sm text-zinc-400" role="status">Buscando…</p>
			{:else}
				<p class="mb-3 text-sm text-zinc-400">
					{source.games.toLocaleString('es-ES')} juegos{source.indexedAt
						? `, mirados el ${when(source.indexedAt)}`
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
				<form method="post" action="?seccion={tab}&/ownGamesIndex" use:enhance={submit}>
					<button class={secondary} disabled={busy || source.scanning}>Volver a buscar</button>
				</form>
				<button class={secondary} onclick={() => (editing = !editing)}>Cambiar</button>
				<form method="post" action="?seccion={tab}&/ownGamesRemove" use:enhance={submit}>
					<button class={secondary} disabled={busy}>Quitar</button>
				</form>
			</div>
		{/if}

		{#if !source || editing}
			{#if data.ownMusic}
				<form
					method="post"
					action="?seccion={tab}&/ownGamesUseMusic"
					use:enhance={submit}
					class="mt-4 rounded-md border border-zinc-800 p-3"
				>
					<p class="mb-2 text-sm">
						El mismo de Tu música (<span class="text-zinc-200">{data.ownMusic.label}</span>), con
						los juegos en la carpeta <code>Juegos/</code> del bucket.
					</p>
					<button class={primary} disabled={busy}>
						{busy ? 'Comprobando…' : 'Usar el de Tu música'}
					</button>
					<!-- Said here, by the button: under the whole form below, it went unseen. -->
					{#if problem}
						<p class="mt-2 text-sm text-red-400">{problem}</p>
					{:else if ok}
						<p class="mt-2 text-sm text-emerald-400">{ok}</p>
					{/if}
				</form>
				<p class="mt-4 text-sm text-zinc-400">O en otro sitio:</p>
			{/if}
			<form
				method="post"
				action="?seccion={tab}&/ownGamesSave"
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
					Carpeta de los juegos dentro del bucket
					<input
						name="prefix"
						class={field}
						placeholder="Juegos/ (vacío: todo el bucket)"
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
					juegos que tengáis derecho a usar, y para la familia.
				</p>
				<button class={primary} disabled={busy}>{busy ? 'Comprobando…' : 'Guardar'}</button>
			</form>
		{/if}

		{#if !(data.ownMusic && (!source || editing))}
			{#if problem}
				<p class="mt-3 text-sm text-red-400">{problem}</p>
			{:else if ok}
				<p class="mt-3 text-sm text-emerald-400">{ok}</p>
			{/if}
		{/if}
	</section>
{/if}
