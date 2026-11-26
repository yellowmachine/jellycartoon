<!--
@component
Notas' drawings: its tabs and its buttons, with the same line as the sections (SectionIcon) and the
home cards (CardIcon) instead of emoji, which each phone draws its own way.
-->
<script lang="ts" module>
	export type NoteIconName =
		'voz' | 'foto' | 'texto' | 'leer' | 'galeria' | 'parar' | 'lugar' | 'casa';

	export interface NoteIconProps {
		/** Which drawing. */
		name: NoteIconName;
		/** Classes for the drawing, its size by default. */
		class?: string;
	}
</script>

<script lang="ts">
	let { name, class: className = 'h-4 w-4' }: NoteIconProps = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={['shrink-0', className]}
	aria-hidden="true"
>
	{#if name === 'voz'}
		<!-- A microphone (Lucide's mic). -->
		<path d="M12 19v3" />
		<path d="M19 10v2a7 7 0 0 1-14 0v-2" />
		<rect x="9" y="2" width="6" height="13" rx="3" />
	{:else if name === 'foto'}
		<!-- A camera (Lucide's camera). -->
		<path
			d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"
		/>
		<circle cx="12" cy="13" r="3" />
	{:else if name === 'texto'}
		<!-- A pencil writing a line (Lucide's pen-line). -->
		<path d="M13 21h8" />
		<path
			d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"
		/>
	{:else if name === 'leer'}
		<!-- An open book (Lucide's book-open), as Deberes on the home page. -->
		<path d="M12 7v14" />
		<path
			d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"
		/>
	{:else if name === 'galeria'}
		<!-- A picture (Lucide's image): one already taken. -->
		<rect width="18" height="18" x="3" y="3" rx="2" />
		<circle cx="9" cy="9" r="2" />
		<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
	{:else if name === 'parar'}
		<!-- A square, to stop recording (Lucide's square). -->
		<rect width="14" height="14" x="5" y="5" rx="2" />
	{:else if name === 'lugar'}
		<!-- A pin on a map (Lucide's map-pin). -->
		<path
			d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"
		/>
		<circle cx="12" cy="10" r="3" />
	{:else if name === 'casa'}
		<!-- A house (Lucide's house): the whole house's. -->
		<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
		<path
			d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
		/>
	{/if}
</svg>
