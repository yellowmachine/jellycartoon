<script lang="ts">
	import { enhance } from '$app/forms';
	import { sizeText } from '#lib/storage-size.ts';
	import { field, secondary, section } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	/**
	 * Each family's storage (#480), the fullest first: how much it keeps, its quota, and its own one
	 * when the default (STORAGE_QUOTA_MB) is not enough.
	 */
	let { data, form }: PageProps = $props();

	const card = section.replace('mb-8 ', '');
	const gb = (bytes: number) =>
		(bytes / 1024 ** 3).toLocaleString('es-ES', { maximumFractionDigits: 2 });
</script>

<svelte:head>
	<title>Espacio · Admin · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<a href="/admin" class="text-sm text-zinc-400 hover:text-zinc-200">← Admin</a>
	<h1 class="mt-2 mb-1 text-2xl font-bold">Espacio</h1>
	<p class="mb-6 text-sm text-zinc-400">
		Lo que guarda cada familia. Por defecto {sizeText(data.defaultMb * 1024 * 1024)}
		(STORAGE_QUOTA_MB); vacío, vuelve a ese.
	</p>
	{#if form && 'problem' in form}
		<p class="mb-4 text-sm text-red-400">{form.problem}</p>
	{/if}

	<ul class="space-y-3">
		{#each data.families as f (f.familyId)}
			{@const share = Math.min(1, f.used / f.limit)}
			<li class={card}>
				<div class="mb-2 flex flex-wrap items-baseline gap-x-2">
					<strong>{f.name}</strong>
					<span class="ml-auto text-sm {share >= 1 ? 'text-red-400' : 'text-zinc-400'}">
						{sizeText(f.used)} de {sizeText(f.limit)}{f.custom ? ' (propia)' : ''}
					</span>
				</div>
				<div class="mb-3 h-2 overflow-hidden rounded-full bg-zinc-800">
					<div
						class="h-full rounded-full {share >= 1
							? 'bg-red-500'
							: share >= 0.8
								? 'bg-amber-400'
								: 'bg-emerald-500'}"
						style="width: {share * 100}%"
					></div>
				</div>
				<form method="post" action="?/limit" use:enhance class="flex items-center gap-2">
					<input type="hidden" name="family" value={f.familyId} />
					<input
						name="gb"
						inputmode="decimal"
						class="{field} w-28"
						placeholder="GB"
						aria-label="Cuota de {f.name} en GB"
						value={f.custom ? gb(f.limit) : ''}
					/>
					<span class="text-sm text-zinc-400">GB</span>
					<button class={secondary}>Guardar</button>
					{#if form && 'saved' in form && form.saved === f.familyId}
						<span class="text-sm text-emerald-400">✓</span>
					{/if}
				</form>
			</li>
		{/each}
	</ul>
</div>
