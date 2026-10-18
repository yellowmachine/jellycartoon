<script lang="ts">
	import { page } from '$app/state';

	// The TV view (#11) has no site around it: bigger, and the remote needs something with the focus.
	const tv = $derived(page.url.pathname === '/tv' || page.url.pathname.startsWith('/tv/'));
	const home = $derived(tv ? '/tv' : '/');

	/** A mistake in the address or a page that is not there (4xx), or the server failing (5xx). */
	const broken = $derived(page.status >= 500);
	// SvelteKit's own, in English («Not Found», «Internal Error»), say nothing the drawing does not.
	const detail = $derived(
		!broken && page.error?.message !== 'Not Found' ? page.error?.message : undefined
	);

	let first = $state<HTMLElement>();
	$effect(() => {
		if (tv) first?.focus();
	});
</script>

<svelte:head>
	<title
		>{broken ? 'Error' : page.status === 404 ? 'No encontrado' : page.status} · JellyCartoon</title
	>
</svelte:head>

<section
	class={[
		'mx-auto flex flex-col items-center text-center',
		tv ? 'min-h-screen max-w-3xl justify-center gap-8 px-12' : 'max-w-md gap-5 py-12'
	]}
>
	{#if broken}
		<!-- A frame of film burning in the projector: the hole opens from the middle. -->
		<svg viewBox="0 0 200 160" class={tv ? 'w-96' : 'w-64'} aria-hidden="true">
			<rect x="10" y="20" width="180" height="120" rx="4" class="fill-zinc-900" />
			{#each { length: 9 } as _, i (i)}
				<rect x={18 + i * 20} y="27" width="8" height="8" rx="1.5" class="fill-zinc-950" />
				<rect x={18 + i * 20} y="125" width="8" height="8" rx="1.5" class="fill-zinc-950" />
			{/each}
			<rect x="30" y="44" width="140" height="72" rx="2" class="fill-zinc-800" />
			<!-- What was on screen: hills under the sun. -->
			<circle cx="140" cy="62" r="8" class="fill-zinc-600" />
			<path d="M30 116 62 84l22 18 30-30 56 44Z" class="fill-zinc-700" />
			<g class="burn">
				<path
					d="M100 50c13-3 19 8 25 10 9 4 5 17 3 23-2 11-13 15-24 13-11 4-24 0-28-9-6-9-2-20 2-26 7-9 14-11 22-11Z"
					transform="translate(-27 -16) scale(1.27)"
					class="fill-orange-500/30"
				/>
				<path
					d="M100 50c13-3 19 8 25 10 9 4 5 17 3 23-2 11-13 15-24 13-11 4-24 0-28-9-6-9-2-20 2-26 7-9 14-11 22-11Z"
					transform="translate(-10 -6) scale(1.1)"
					class="fill-amber-300"
				/>
				<path
					d="M100 50c13-3 19 8 25 10 9 4 5 17 3 23-2 11-13 15-24 13-11 4-24 0-28-9-6-9-2-20 2-26 7-9 14-11 22-11Z"
					class="fill-zinc-950"
				/>
			</g>
		</svg>
		<h1 class={['font-bold text-orange-400', tv ? 'text-5xl' : 'text-2xl']}>
			Se ha quemado la película
		</h1>
		<p class="text-zinc-400">Problemas en la cabina de proyección. Estamos rebobinando.</p>
		<div class="flex gap-3">
			<button
				bind:this={first}
				onclick={() => location.reload()}
				class={[
					'rounded-md bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400',
					tv ? 'px-8 py-4' : 'px-4 py-2'
				]}>Reintentar</button
			>
			<a
				href={home}
				class={[
					'rounded-md border border-zinc-700 hover:bg-zinc-900',
					tv ? 'px-8 py-4' : 'px-4 py-2'
				]}>Volver al inicio</a
			>
		</div>
	{:else}
		<!-- A clapperboard for a scene that is not in the film: open, and nothing to shoot. -->
		<svg viewBox="0 0 200 160" class={tv ? 'w-96' : 'w-64'} aria-hidden="true">
			<defs>
				<pattern id="stripes" width="28" height="20" patternUnits="userSpaceOnUse">
					<path d="M0 0h14L6 20H-8ZM28 0h14l-8 20H20Z" class="fill-zinc-100" />
				</pattern>
			</defs>
			<g class="clapper">
				<rect x="20" y="38" width="164" height="18" rx="3" class="fill-zinc-900" />
				<rect x="20" y="38" width="164" height="18" rx="3" fill="url(#stripes)" />
			</g>
			<rect x="20" y="58" width="164" height="18" class="fill-zinc-900" />
			<rect x="20" y="58" width="164" height="18" fill="url(#stripes)" />
			<rect x="20" y="76" width="164" height="72" rx="4" class="fill-zinc-900" />
			<circle cx="24" cy="58" r="3.5" class="fill-zinc-500" />
			<path d="M20 112h164M120 76v72" class="stroke-zinc-600" stroke-width="1.5" />
			<g class="fill-zinc-400" font-family="ui-monospace, monospace" font-size="10">
				<text x="30" y="94">ESCENA</text>
				<text x="130" y="94">TOMA</text>
			</g>
			<g font-family="ui-monospace, monospace" font-weight="bold" font-size="30">
				<text x="30" y="140" class="fill-amber-400">{page.status}</text>
				<text x="142" y="140" class="fill-zinc-100">?</text>
			</g>
		</svg>
		<h1 class={['font-bold text-amber-400', tv ? 'text-5xl' : 'text-2xl']}>¡Corten!</h1>
		<p class="text-zinc-400">
			{page.status === 404
				? 'Esta escena no está en el montaje.'
				: 'Esta escena no se puede rodar.'}
		</p>
		{#if detail}
			<p class={['text-zinc-500', tv ? 'text-xl' : 'text-sm']}>{detail}</p>
		{/if}
		<a
			bind:this={first}
			href={home}
			class={[
				'rounded-md bg-amber-500 font-semibold text-zinc-950 hover:bg-amber-400',
				tv ? 'px-8 py-4' : 'px-4 py-2'
			]}>Volver al inicio</a
		>
	{/if}
</section>

<style>
	/* The clapper swings, as if about to clap; the burn flickers. Still for who asks for less motion. */
	.clapper {
		transform-origin: 24px 56px;
		transform: rotate(-16deg);
		animation: swing 2.4s ease-in-out infinite alternate;
	}
	.burn {
		transform-origin: 100px 74px;
		animation: flicker 1.6s ease-in-out infinite alternate;
	}
	@keyframes swing {
		to {
			transform: rotate(-8deg);
		}
	}
	@keyframes flicker {
		from {
			transform: scale(0.94);
		}
		to {
			transform: scale(1.04);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.clapper,
		.burn {
			animation: none;
		}
	}
</style>
