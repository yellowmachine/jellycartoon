<script lang="ts" module>
	import error404 from '../dibujos/404.svg?raw';
	import error500 from '../dibujos/500.svg?raw';
	import fuera from '../dibujos/fuera-de-casa.svg?raw';
	import portada from '../dibujos/portada.svg?raw';

	/**
	 * The cloud's drawings (#253), in the line of its icon: the snail whose shell unrolls into it.
	 * Its lines take the text colour (currentColor), the details are amber; the antennae and the
	 * details move a little, unless asked for less motion. Files in ../dibujos, also served raw by
	 * jellycartoon's /fuera-de-casa.
	 */
	const DRAWINGS = { '404': error404, '500': error500, fuera, portada };
	export type Drawing = keyof typeof DRAWINGS;
</script>

<script lang="ts">
	let { name, class: className = '' }: { name: Drawing; class?: string } = $props();
</script>

<div class={['[&>svg]:block [&>svg]:w-full', className]}>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- our own files (../dibujos), never what was typed. -->
	{@html DRAWINGS[name]}
</div>
