<script lang="ts">
	import {
		PAD_BUTTONS,
		type ConsoleButton,
		type Controls,
		type PadButton
	} from '#lib/game-controls.ts';

	/**
	 * A gamepad as most are (#176), drawn here, with the console's button each of its buttons does
	 * on it: choosing one of them asks which. Its buttons are where the standard gamepad has them,
	 * whatever is printed on them.
	 */
	let {
		controls,
		buttons,
		selected,
		onchoose
	}: {
		controls: Controls;
		buttons: ConsoleButton[];
		selected: PadButton | null;
		onchoose: (pad: PadButton) => void;
	} = $props();

	/** What each of the gamepad's does: one of the console's, or nothing. */
	const does = $derived(
		Object.fromEntries(
			Object.entries(controls).map(([id, pad]) => [pad, buttons.find((b) => String(b.id) === id)])
		) as Partial<Record<PadButton, ConsoleButton>>
	);

	/** Sizes, as a share of the drawing's width. */
	const WIDTH = { face: 8, shoulder: 19, small: 13 };
</script>

<div class="relative mx-auto aspect-[640/400] w-full max-w-2xl select-none">
	<svg viewBox="0 0 640 400" class="absolute inset-0 h-full w-full" aria-hidden="true">
		<g class="fill-zinc-800 stroke-zinc-600" stroke-width="2">
			<!-- Triggers behind, then shoulders. -->
			<rect x="105" y="6" width="110" height="44" rx="18" />
			<rect x="425" y="6" width="110" height="44" rx="18" />
			<rect x="95" y="56" width="130" height="36" rx="16" />
			<rect x="415" y="56" width="130" height="36" rx="16" />
		</g>
		<path
			d="M170 80H470C545 80 590 120 610 200C630 285 625 360 575 375C535 387 505 350 480 310L455 272H185L160 310C135 350 105 387 65 375C15 360 10 285 30 200C50 120 95 80 170 80Z"
			class="fill-zinc-900 stroke-zinc-600"
			stroke-width="3"
		/>
		<!-- The cross and the sticks, which keep what they do. -->
		<g class="fill-zinc-700">
			<rect x="128" y="146" width="44" height="84" rx="8" />
			<rect x="108" y="166" width="84" height="44" rx="8" />
		</g>
		<g class="fill-zinc-800 stroke-zinc-700" stroke-width="3">
			<circle cx="232" cy="262" r="32" />
			<circle cx="408" cy="262" r="32" />
		</g>
		<g class="fill-zinc-700">
			<circle cx="232" cy="262" r="20" />
			<circle cx="408" cy="262" r="20" />
			<circle cx="320" cy="122" r="14" />
		</g>
		<!-- Which button the gamepad says it is, outside its round of four. -->
		<g class="fill-zinc-500 text-[15px] font-semibold">
			{#each PAD_BUTTONS.filter((b) => b.kind === 'face') as b (b.name)}
				<text x={b.x + (b.x - 500) * 0.95} y={b.y + (b.y - 188) * 0.95 + 5} text-anchor="middle"
					>{b.label}</text
				>
			{/each}
		</g>
		<g class="fill-zinc-500 text-[13px]">
			{#each PAD_BUTTONS.filter((b) => b.kind === 'small') as b (b.name)}
				<text x={b.x} y={b.y + 34} text-anchor="middle">{b.label}</text>
			{/each}
		</g>
	</svg>

	{#each PAD_BUTTONS as b (b.name)}
		{@const doing = does[b.name]}
		<button
			type="button"
			class={[
				'absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center border-2 font-bold transition duration-150 focus-visible:outline-none',
				b.kind === 'face'
					? 'aspect-square rounded-full text-[clamp(0.8rem,3vw,1.4rem)]'
					: 'rounded-full py-[0.6%] text-[clamp(0.65rem,2vw,0.95rem)]',
				selected === b.name
					? 'scale-110 border-lime-300 bg-lime-300 text-zinc-950'
					: doing
						? 'border-zinc-500 bg-zinc-700 text-white hover:border-lime-300 focus-visible:border-lime-300'
						: 'border-dashed border-zinc-700 bg-zinc-900 text-zinc-600 hover:border-lime-300 focus-visible:border-lime-300'
			]}
			style:left="{b.x / 6.4}%"
			style:top="{b.y / 4}%"
			style:width="{WIDTH[b.kind]}%"
			aria-label="{b.label} del mando: {doing ? doing.label : 'nada'}"
			aria-pressed={selected === b.name}
			onclick={() => onchoose(b.name)}
		>
			{#if b.kind !== 'shoulder'}
				<span class="truncate px-1">{doing?.short ?? '·'}</span>
			{:else}
				<span class="truncate px-1"
					><span class="font-normal opacity-70">{b.label}</span>
					{doing?.short ?? '·'}</span
				>
			{/if}
		</button>
	{/each}
</div>
