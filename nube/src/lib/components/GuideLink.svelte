<script lang="ts">
	/**
	 * «?» beside a section's title (#495): its page in the family's guide at docs.seilide.app, in
	 * another tab. Inline, so it sits in the title's line without changing its layout.
	 */
	let {
		page,
		label,
		class: className = ''
	}: {
		/** The guide's page and, if any, its heading: `nevera`, `voz#lo-que-recuerda`. */
		page: string;
		/** What it helps with, for its name: «la nevera». */
		label: string;
		class?: string;
	} = $props();

	const [slug, heading] = $derived(page.split('#'));
</script>

<a
	href="https://docs.seilide.app/guia/{slug}/{heading ? `#${heading}` : ''}"
	target="_blank"
	rel="noopener"
	title="Cómo se usa {label}"
	aria-label="Cómo se usa {label} (guía)"
	class={[
		'ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-zinc-600 align-middle text-sm font-semibold text-zinc-400 [text-shadow:none] hover:border-amber-400 hover:text-amber-400',
		className
	]}>?</a
>
