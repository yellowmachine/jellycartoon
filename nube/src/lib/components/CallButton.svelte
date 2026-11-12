<script lang="ts">
	import { goto } from '$app/navigation';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { phone } from '#lib/phone.svelte.ts';

	/**
	 * «Botón de llamar siempre a mano» (#330): big, always at the bottom right, for grandparents.
	 * With one favorite, a tap calls them; otherwise it opens Llamadas, with the favorites first.
	 * During a call on another page, it takes back to it (the call's sound plays there).
	 *
	 * The look is «la cara del favorito, en cuadrado», chosen on a test page among four (2026-11-10):
	 * whoever is called, as their initial on a square with the corners and the green of Seilide's
	 * icon, an amber handset saying what it does, and the name under it. Several favorites, their
	 * faces together; none, the handset alone. During a call, the other's face with a cream line
	 * going round it, and the talk's clock.
	 */
	let { favorites }: { favorites: { userId: string; name: string }[] } = $props();

	const only = $derived(favorites.length === 1 ? favorites[0] : null);
	const label = $derived(
		phone.busy ? 'Volver a la llamada' : only ? `Llamar a ${only.name}` : 'Llamar'
	);

	/** Who the faces are: the other one during a call, else the favorites (three at most). */
	const faces = $derived(phone.busy ? [phone.otherName] : favorites.slice(0, 3).map((f) => f.name));

	/** The talk's clock, ticking while the sound goes both ways. */
	let now = $state(Date.now());
	$effect(() => {
		if (phone.connectedAt === null) return;
		const t = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(t);
	});
	const clock = $derived.by(() => {
		if (phone.connectedAt === null) return null;
		const s = Math.max(0, Math.floor((now - phone.connectedAt) / 1000));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	});
	const caption = $derived(
		phone.busy ? (clock ? `Volver · ${clock}` : 'Volver') : only ? only.name : 'Llamar'
	);

	function initial(name: string) {
		return (Array.from(name.trim())[0] ?? '?').toLocaleUpperCase('es');
	}

	/** One colour per face, so several favorites tell apart: the icon's green first. */
	const tints = [
		'from-[#169b62] to-[#0b5d3b]',
		'from-amber-700 to-amber-900',
		'from-cyan-700 to-cyan-900'
	];

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
	style:bottom="max(1rem, env(safe-area-inset-bottom))"
	class="group fixed right-4 z-40 flex max-w-[calc(100vw-2rem)] cursor-pointer flex-col items-center gap-1.5 rounded-2xl focus-visible:outline-offset-4"
>
	<span class="relative flex">
		<!-- An amber handset at the corner: what a tap does. -->
		<span
			class={[
				'absolute -bottom-1 z-10 grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-amber-400 text-stone-900 ring-[3px] ring-zinc-950',
				faces.length > 1 ? '-left-4' : '-left-1.5'
			]}
		>
			<SectionIcon name="llamadas" class="h-[18px] w-[18px] [stroke-width:2.25]" />
		</span>
		{#if faces.length === 0}
			<span
				class="grid h-[76px] w-[76px] place-items-center rounded-[22%] bg-linear-to-b from-[#169b62] to-[#0b5d3b] text-[#fbf3e0] shadow-[0_0_0_3px_#fbf3e0,0_10px_24px_-6px_rgb(0_0_0/0.8)] group-hover:brightness-110"
			>
				<SectionIcon name="llamadas" class="h-9 w-9" />
			</span>
		{:else}
			{#each faces as name, i (i)}
				<span
					class={[
						'grid place-items-center rounded-[22%] bg-linear-to-b font-bold text-[#fbf3e0] group-hover:brightness-110',
						tints[i],
						faces.length > 1
							? 'h-[58px] w-[58px] text-2xl shadow-[0_0_0_3px_var(--color-zinc-950)] not-first:-ml-3.5'
							: 'h-[76px] w-[76px] text-[2rem] shadow-[0_0_0_3px_#fbf3e0,0_10px_24px_-6px_rgb(0_0_0/0.8)]'
					]}
					aria-hidden="true">{initial(name)}</span
				>
			{/each}
		{/if}
		<!-- During a call, a cream line going round the face: the words stay still, for whoever reads slowly. -->
		{#if phone.busy}
			<svg
				class="pointer-events-none absolute -inset-1.5 h-[calc(100%+0.75rem)] w-[calc(100%+0.75rem)] overflow-visible"
				viewBox="0 0 100 100"
				aria-hidden="true"
			>
				<rect
					x="1.5"
					y="1.5"
					width="97"
					height="97"
					rx="22"
					pathLength="1"
					class="ronda fill-none stroke-[#fbf3e0]"
				/>
			</svg>
		{/if}
	</span>
	<span
		class="max-w-full truncate rounded-[10px] border border-zinc-700 bg-zinc-900/95 px-3.5 py-1 text-lg font-bold text-zinc-100 tabular-nums"
	>
		{caption}
	</span>
</button>

<style>
	.ronda {
		stroke-width: 3;
		stroke-linecap: round;
		stroke-dasharray: 0.28 0.72;
		vector-effect: non-scaling-stroke;
		animation: ronda 2.4s linear infinite;
	}
	@keyframes ronda {
		to {
			stroke-dashoffset: -1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ronda {
			animation: none;
			stroke-dasharray: none;
		}
	}
</style>
