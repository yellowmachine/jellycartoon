<script lang="ts">
	/**
	 * A frame behind the top of a series' or a film's page, as the platforms do (from under the
	 * app's bar, the page's <main> being its box; the whole screen in the TV view): sharp at the top,
	 * more and more blurred and dark going down, until it is the page's own background. Two copies
	 * of the image: the sharp one fades out over the blurred one. As wide as the page's content,
	 * fading out at its sides on a wide screen: a frame is not made for a whole wide screen. Shown
	 * once loaded; with none (not made yet, or no episode to take it from), nothing.
	 */
	let { src }: { src: string } = $props();

	let loaded = $state(false);
	let failed = $state(false);
	let sharp = $state<HTMLImageElement>();
	$effect(() => {
		void src;
		loaded = false;
		failed = false;
		// Loaded before the page came to life (from the server, on a slow device such as the living
		// room's): its `load` was missed, and it would stay hidden.
		if (sharp?.complete) {
			if (sharp.naturalWidth) loaded = true;
			else failed = true;
		}
	});
</script>

{#if !failed}
	<div
		class="pointer-events-none absolute inset-x-0 top-0 -z-10 flex justify-center"
		aria-hidden="true"
	>
		<div
			class={[
				'sides relative h-[26rem] w-full max-w-6xl overflow-hidden transition-opacity duration-700 sm:h-[32rem]',
				loaded ? 'opacity-100' : 'opacity-0'
			]}
		>
			<img
				{src}
				alt=""
				referrerpolicy="no-referrer"
				class="blurred absolute inset-0 h-full w-full object-cover"
			/>
			<img
				{src}
				alt=""
				referrerpolicy="no-referrer"
				class="sharp absolute inset-0 h-full w-full object-cover"
				bind:this={sharp}
				onload={() => (loaded = true)}
				onerror={() => (failed = true)}
			/>
			<!-- Darker going down, so the page's text reads over it, ending in the page's own colour. -->
			<div
				class="absolute inset-0 bg-gradient-to-b from-zinc-950/45 via-zinc-950/75 to-zinc-950"
			></div>
		</div>
	</div>
{/if}

<style>
	img {
		object-position: center 30%;
	}
	.sharp {
		mask-image: linear-gradient(to bottom, black 0%, black 25%, transparent 75%);
	}
	.blurred {
		filter: blur(28px) saturate(1.2);
		transform: scale(1.1);
	}
	/* Wider than the content: its sides fade into the page. */
	@media (min-width: 72rem) {
		.sides {
			mask-image: linear-gradient(to right, transparent, black 12%, black 88%, transparent);
		}
	}
</style>
