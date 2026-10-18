<script lang="ts">
	import { watchSalon } from '#lib/salon.svelte.ts';

	/**
	 * On the TV, what mpv could not open (a channel off the air…): the screen is back on the app,
	 * and without this it would look as if nothing had been chosen.
	 */
	const salon = watchSalon();
</script>

{#if salon.state?.failed}
	<p
		role="alert"
		class="fixed bottom-8 left-8 max-w-xl rounded-full border border-red-400/40 bg-red-950/90 px-6 py-3 text-xl text-red-200 shadow-lg backdrop-blur"
	>
		{salon.state.failed}
	</p>
{/if}
