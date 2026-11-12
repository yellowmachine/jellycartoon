<script lang="ts">
	import { section } from '#lib/styles.ts';
	import { sizeText } from '#lib/storage-size.ts';
	import type { PageData } from './$types';

	/**
	 * How much the family keeps in Seilide (#480): its photos, voice notes, tickets, papers… and its
	 * quota. Full, nothing more can be kept until something goes.
	 */
	let { data }: { data: PageData } = $props();

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
	const share = $derived(use ? Math.min(1, use.used / use.limit) : 0);
</script>

{#if use}
	<section class={section} id="espacio">
		<h2 class="mb-1 font-semibold">Espacio</h2>
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
		{#if use.areas.length}
			<ul class="space-y-1 text-sm text-zinc-400">
				{#each use.areas as a (a.area)}
					<li class="flex justify-between gap-3">
						<span>{AREAS[a.area] ?? a.area}</span>
						<span class="tabular-nums">{sizeText(a.bytes)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
