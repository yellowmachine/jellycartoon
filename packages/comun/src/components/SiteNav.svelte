<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { Section } from './SectionIcon.svelte';

	/** A section in the bar; `external`, in the other app (the cloud's links to the house, #253). */
	export interface NavLink {
		href: string;
		label: string;
		icon: Section;
		/** Other addresses that are this section too (its tabs). */
		also?: string[];
		external?: boolean;
	}

	/** A row of the user's menu: Ajustes (`icon: 'ajustes'`), Gestión, Vista TV… */
	export interface UserLink {
		href: string;
		label: string;
		icon: Section | 'ajustes';
		external?: boolean;
	}
</script>

<script lang="ts">
	import { page } from '$app/state';
	import ActionMenu from './ActionMenu.svelte';
	import SectionIcon from './SectionIcon.svelte';

	/**
	 * The app's bar (jellycartoon's, #253): the same in the house and in the cloud. On wide screens
	 * every section in a row; on a tablet, as a tab bar, each icon over its name; on a phone, the
	 * section you are in and a menu with all of them. The user's round badge opens their menu. What
	 * only one app has goes in its snippets: after the name (`leading`: the microphone, the
	 * receipt's photo), instead of the badge's menu (`account`: a child's), and under the bar
	 * (`below`: what plays, the timers…).
	 */
	let {
		brand,
		links,
		/** In the phone's menu: the sections and the rest (Gestión). */
		menuLinks = links,
		user,
		/** In the badge's menu, after its name; «Salir» always last. */
		userLinks,
		/** The phone's menu offers «Salir» (not to a child, who could not get back in). */
		canLeave = true,
		headerHeight = $bindable(0),
		leading,
		account,
		below
	}: {
		brand: { href: string; title: string; image: string };
		links: NavLink[];
		menuLinks?: NavLink[];
		user: { name: string; badge: string; mark: string };
		userLinks: UserLink[];
		canLeave?: boolean;
		headerHeight?: number;
		leading?: Snippet;
		account?: Snippet<[{ isCurrent: (href: string) => boolean }]>;
		below?: Snippet;
	} = $props();

	let menu = $state<HTMLElement>();

	const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);
	/** The section a page is in: its own address or, for those with tabs, any of theirs. */
	const isCurrent = (href: string) => {
		const path = page.url.pathname;
		const link = menuLinks.find((l) => l.href === href);
		if (link?.external) return false;
		const also = link?.also ?? [];
		return (href === '/' ? path === '/' : under(path, href)) || also.some((h) => under(path, h));
	};
	const current = $derived(menuLinks.find((l) => l.href !== '/' && isCurrent(l.href)));
	const settings = $derived(userLinks.find((l) => l.icon === 'ajustes'));

	/** The user's menu: a row with its icon, drawn as the sections' (Lucide's sliders and log-out). */
	const userItem =
		'flex w-full items-center gap-2.5 rounded px-3 py-1.5 text-left hover:bg-zinc-800';
	const iconSvg = {
		viewBox: '0 0 24 24',
		fill: 'none',
		stroke: 'currentColor',
		'stroke-width': 1.5,
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round',
		class: 'h-[18px] w-[18px] shrink-0',
		'aria-hidden': 'true'
	} as const;
</script>

<!-- In the other app (#253): a small arrow out after its name (Lucide's arrow-up-right). -->
{#snippet out(external?: boolean)}
	{#if external}<svg
			{...iconSvg}
			class="ml-0.5 inline h-3 w-3 shrink-0 align-[0.1em] opacity-70"
			stroke-width="2"><path d="M7 7h10v10M7 17 17 7" /></svg
		>{/if}
{/snippet}

<header
	bind:offsetHeight={headerHeight}
	class="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur"
>
	<nav class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 md:max-lg:gap-3 md:max-lg:py-2">
		<!-- On a tablet, only the picture: the sections need the room. -->
		<a
			href={brand.href}
			title={brand.title}
			class="flex shrink-0 items-center gap-2 text-lg font-bold text-amber-400"
		>
			<img src={brand.image} alt="" class="h-7 w-7 rounded-md" />
			<span class="md:max-lg:sr-only">{brand.title}</span>
		</a>
		{@render leading?.()}
		<!-- Wide screens: every link in a row; with its icon from xl, as with every section both do
		     not fit in 1024px. A tablet (md, up to lg): every link too, its icon over a small
		     name, as a tab bar; the one you are in, in amber. -->
		{#each links as link (link.href)}
			<a
				href={link.href}
				class={[
					'hidden items-center gap-1.5 text-sm hover:text-white lg:inline-flex',
					'md:max-lg:flex md:max-lg:min-w-0 md:max-lg:flex-1 md:max-lg:flex-col md:max-lg:gap-0.5 md:max-lg:text-[11px]',
					isCurrent(link.href) ? 'text-white md:max-lg:text-amber-400' : 'text-zinc-400'
				]}
				><SectionIcon
					name={link.icon}
					class="hidden h-[18px] w-[18px] shrink-0 md:max-lg:block md:max-lg:h-6 md:max-lg:w-6 xl:block"
				/><span class="max-w-full truncate">{link.label}{@render out(link.external)}</span></a
			>
		{/each}
		<div class="ml-auto hidden items-center md:flex">
			{#if account}
				{@render account({ isCurrent })}
			{:else}
				<!-- The user's menu: what is not a section to watch or listen to. -->
				<ActionMenu id="user-menu" plain label="{user.name} · Menú" width="w-max min-w-40 max-w-64">
					{#snippet icon()}
						<span
							class={[
								'flex h-8 w-8 items-center justify-center rounded-full',
								user.badge,
								userLinks.some((l) => !l.external && isCurrent(l.href)) &&
									'ring-2 ring-amber-300 ring-offset-2 ring-offset-zinc-950'
							]}>{user.mark}</span
						>
					{/snippet}
					{#snippet children(close)}
						<p class="truncate px-3 py-1.5 text-xs text-zinc-400">{user.name}</p>
						{#each userLinks as link (link.href)}
							<a href={link.href} onclick={close} class={userItem}
								>{#if link.icon === 'ajustes'}<svg {...iconSvg}
										><path
											d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"
										/></svg
									>{:else}<SectionIcon
										name={link.icon}
										class="h-[18px] w-[18px] shrink-0"
									/>{/if}{link.label}{@render out(link.external)}</a
							>
						{/each}
						<hr class="my-1 border-zinc-800" />
						<form method="post" action="/logout">
							<button class={userItem}
								><svg {...iconSvg}
									><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg
								>Salir</button
							>
						</form>
					{/snippet}
				</ActionMenu>
			{/if}
		</div>

		<!-- Phone: the section you are in and a menu with the rest. -->
		{#if current}
			<span class="-ml-3 truncate text-sm text-zinc-300 md:hidden">{current.label}</span>
		{/if}
		<button
			class="ml-auto rounded-md px-2 py-1 text-xl text-zinc-300 hover:bg-zinc-800 md:hidden"
			aria-label="Menú"
			popovertarget="site-menu">☰</button
		>
	</nav>
	<div
		bind:this={menu}
		id="site-menu"
		popover="auto"
		class="inset-x-0 top-14 bottom-auto m-0 max-h-[calc(100dvh-3.5rem)] w-auto overflow-y-auto overscroll-contain border-b border-zinc-800 bg-zinc-950 px-4 pt-2 pb-4 text-zinc-100 shadow-lg md:hidden"
	>
		<!-- Two columns: every section in view at once; scrolled only if even so it does not fit
		     (a phone on its side). -->
		<ul class="grid grid-cols-2 gap-x-2">
			{#each menuLinks as link (link.href)}
				<li>
					<a
						href={link.href}
						onclick={() => menu?.hidePopover()}
						class={[
							'flex min-w-0 items-center gap-3 rounded-md px-2 py-3 text-base hover:bg-zinc-900',
							isCurrent(link.href) ? 'text-amber-400' : 'text-zinc-200'
						]}
						><SectionIcon name={link.icon} class="h-6 w-6 shrink-0" /><span class="truncate"
							>{link.label}{@render out(link.external)}</span
						></a
					>
				</li>
			{/each}
		</ul>
		<form
			method="post"
			action="/logout"
			class="mt-2 flex items-center justify-between border-t border-zinc-800 pt-2"
		>
			<a
				href={settings?.href ?? '/ajustes'}
				onclick={() => menu?.hidePopover()}
				class="flex items-center gap-2 py-2 text-sm text-zinc-300 hover:text-white"
			>
				<span
					class="flex h-8 w-8 items-center justify-center rounded-full {user.badge}"
					aria-hidden="true">{user.mark}</span
				>
				{user.name} · Ajustes
			</a>
			{#if canLeave}
				<button class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900">
					Salir
				</button>
			{/if}
		</form>
	</div>
	{@render below?.()}
</header>
