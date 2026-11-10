<script lang="ts">
	import { goto } from '$app/navigation';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { phone } from '#lib/phone.svelte.ts';

	/**
	 * «Botón de llamar siempre a mano» (#330): big, green, always at the bottom right, for
	 * grandparents. With one favorite, a tap calls them; otherwise it opens Llamadas, with the
	 * favorites first. During a call on another page, it takes back to it (the call's sound plays
	 * there).
	 */
	let {
		favorites,
		aboveKitchen = false
	}: {
		favorites: { userId: string; name: string }[];
		/** The kitchen panel open: under the page on a phone, at its side on a wider screen. */
		aboveKitchen?: boolean;
	} = $props();

	const only = $derived(favorites.length === 1 ? favorites[0] : null);
	const label = $derived(
		phone.busy ? 'Volver a la llamada' : only ? `Llamar a ${only.name}` : 'Llamar'
	);

	function press() {
		if (!phone.busy && only) void phone.call(only.userId, only.name);
		void goto('/llamadas');
	}
</script>

<button
	type="button"
	aria-label={label}
	title={label}
	onclick={press}
	style:bottom={aboveKitchen ? undefined : 'max(1rem, env(safe-area-inset-bottom))'}
	class={[
		'fixed right-4 z-40 flex min-h-16 max-w-[calc(100vw-2rem)] items-center gap-3 rounded-full py-3 pr-6 pl-4 text-xl font-bold text-white shadow-xl ring-4 ring-black/30 focus-visible:ring-white',
		phone.busy
			? 'bg-emerald-500 hover:bg-emerald-400'
			: 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700',
		aboveKitchen && 'bottom-[calc(55dvh+1rem)] md:right-[calc(42%+1rem)] md:bottom-4'
	]}
>
	<!-- During a call, a halo beating behind it: the words stay sharp, for whoever reads slowly. -->
	{#if phone.busy}
		<span
			class="absolute inset-0 -z-10 animate-ping rounded-full bg-emerald-400/60"
			aria-hidden="true"
		></span>
	{/if}
	<SectionIcon name="llamadas" class="h-8 w-8 shrink-0" />
	<span class="truncate">{label}</span>
</button>
