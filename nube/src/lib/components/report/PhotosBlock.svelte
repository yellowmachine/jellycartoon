<script lang="ts">
	import type { PhotosBlock } from '#lib/reports.ts';

	/** A report's photos (#505), from the road mode and the walks: each opens whole. */
	let { block }: { block: PhotosBlock } = $props();

	const src = (p: PhotosBlock['photos'][number]) =>
		p.from === 'viaje' ? `/viajes/fotos/${p.id}` : `/paseos/fotos/${p.id}`;
	const when = new Intl.DateTimeFormat('es-ES', {
		weekday: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
</script>

<ul class="grid grid-cols-3 gap-1 sm:grid-cols-4">
	{#each block.photos as p (`${p.from}${p.id}`)}
		<li>
			<a href={src(p)} target="_blank" rel="noopener" title={when.format(new Date(p.at))}>
				<img
					src={src(p)}
					alt="Foto del {when.format(new Date(p.at))}"
					loading="lazy"
					class="aspect-square w-full rounded-md bg-zinc-800 object-cover"
				/>
			</a>
		</li>
	{/each}
</ul>
{#if block.more}
	<p class="mt-1 text-sm text-zinc-500">Y {block.more} más.</p>
{/if}
