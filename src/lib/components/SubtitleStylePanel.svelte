<script lang="ts">
	import {
		DEFAULT_SUBTITLE_STYLE,
		SUBTITLE_OPTIONS,
		SUBTITLE_PRESETS,
		subtitleCss,
		type SubtitleStyle
	} from '#lib/subtitle-style.ts';

	interface Props {
		style: SubtitleStyle;
		/** Thumbnail shown behind the preview text; without one, a plain grey. */
		previewImage?: string;
		onchange: (style: SubtitleStyle) => void;
	}

	let { style, previewImage, onchange }: Props = $props();

	const css = $derived(subtitleCss(style));
	const options = Object.entries(SUBTITLE_OPTIONS) as [
		keyof SubtitleStyle,
		{ label: string; choices: Record<string, { label: string }> }
	][];

	function set(key: keyof SubtitleStyle, value: string) {
		onchange({ ...style, [key]: value } as SubtitleStyle);
	}
</script>

<div class="mt-3 rounded-md border border-zinc-800 bg-zinc-900/60 p-4">
	<!-- A screen's shape, to see where they go too: their bottom as in the video (placeCues). -->
	<div
		class="@container relative mb-4 aspect-video max-h-64 w-full overflow-hidden rounded bg-zinc-800 bg-cover bg-center"
		style:background-image={previewImage ? `url(${previewImage})` : undefined}
	>
		<span
			class="absolute left-1/2 max-w-[90%] -translate-x-1/2 px-1.5 text-center leading-snug"
			style:bottom="{css.line === 'auto' ? 5 : 100 - Number(css.line)}%"
			style:font-family={css.fontFamily}
			style:font-weight={css.fontWeight}
			style:font-size="{css.fontScale * 2.6}cqw"
			style:color={css.color}
			style:background={css.background}
			style:text-shadow={css.textShadow}
		>
			Look out below! ¿Qué estás haciendo?
		</span>
	</div>

	<div class="grid gap-3 text-sm sm:grid-cols-[auto_1fr] sm:items-center">
		<span class="text-zinc-400">Estilo</span>
		<div class="flex flex-wrap gap-1">
			{#each SUBTITLE_PRESETS as preset (preset.label)}
				{@const on = Object.entries(preset.style).every(
					([key, value]) => style[key as keyof SubtitleStyle] === value
				)}
				<button
					class={[
						'rounded px-2 py-0.5',
						on ? 'bg-amber-500 text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'
					]}
					onclick={() => onchange({ ...style, ...preset.style })}>{preset.label}</button
				>
			{/each}
		</div>
		{#each options as [key, option] (key)}
			<span class="text-zinc-400">{option.label}</span>
			<div class="flex flex-wrap gap-1">
				{#each Object.entries(option.choices) as [value, choice] (value)}
					<button
						class={[
							'rounded px-2 py-0.5',
							style[key] === value
								? 'bg-amber-500 text-zinc-950'
								: 'text-zinc-300 hover:bg-zinc-800'
						]}
						style:font-family={key === 'font'
							? (SUBTITLE_OPTIONS.font.choices as Record<string, { css: string }>)[value].css
							: undefined}
						onclick={() => set(key, value)}>{choice.label}</button
					>
				{/each}
			</div>
		{/each}
	</div>

	<button
		class="mt-4 text-xs text-zinc-500 hover:text-zinc-300"
		onclick={() => onchange({ ...DEFAULT_SUBTITLE_STYLE })}>Restablecer</button
	>
</div>
