import type { NavLink, UserLink } from 'comun/components/SiteNav.svelte';
import type { Section } from 'comun/components/SectionIcon.svelte';

/**
 * The bar's sections, as jellycartoon's and in its order (#253), each where it is: in the cloud
 * (its page here), still at home but moving here (`pendiente`: a page that says so, with the way
 * to it at home), or the house's for good (`casa`: straight to jellycartoon, if its address was
 * given in Ajustes). `house`: nothing in it without a house connected (Ajustes), as a family that
 * uses only the cloud: not in its bar.
 */
type Where = 'nube' | 'pendiente' | 'casa';

const SECTIONS: {
	path: string;
	label: string;
	icon: Section;
	where: Where;
	also?: string[];
	house?: true;
}[] = [
	{
		path: '/series',
		label: 'Series',
		icon: 'series',
		where: 'nube',
		also: ['/watch'],
		house: true
	},
	{ path: '/cine', label: 'Cine', icon: 'cine', where: 'casa' },
	{ path: '/musica', label: 'Música', icon: 'musica', where: 'nube', house: true },
	{ path: '/radio', label: 'Radio', icon: 'radio', where: 'nube' },
	{ path: '/canales', label: 'Canales', icon: 'canales', where: 'nube' },
	{ path: '/recetas', label: 'Recetas', icon: 'recetas', where: 'nube' },
	{ path: '/nevera', label: 'Nevera', icon: 'nevera', where: 'nube' },
	{ path: '/agenda', label: 'Agenda', icon: 'agenda', where: 'nube' },
	{ path: '/gastos', label: 'Gastos', icon: 'gastos', where: 'nube' },
	{ path: '/viajes', label: 'Viajes', icon: 'viajes', where: 'nube', also: ['/carretera'] },
	{ path: '/salon', label: 'Salón', icon: 'salon', where: 'casa' },
	{ path: '/juegos', label: 'Juegos', icon: 'juegos', where: 'casa' },
	{ path: '/infantil', label: 'Infantil', icon: 'infantil', where: 'casa' }
];

/** Those still at home but moving here: each has its page saying so ([seccion=pendiente]). */
export const PENDING = SECTIONS.filter((s) => s.where === 'pendiente').map((s) => s.path.slice(1));

/** Where a section of the house is: jellycartoon itself, or a page asking for its address. */
export const atHome = (webUrl: string | null, path: string) =>
	webUrl ? `${webUrl}${path === '/series' ? '/' : path}` : `/en-casa${path}`;

const link = (s: (typeof SECTIONS)[number], webUrl: string | null): NavLink => ({
	href: s.where === 'casa' ? atHome(webUrl, s.path) : s.path,
	label: s.label,
	icon: s.icon,
	also: s.also,
	external: s.where === 'casa' && Boolean(webUrl)
});

/** What a child's bar has (#303): what it may open (kids.ts), and no Ajustes. */
const KID_SECTIONS = ['/agenda', '/nevera'];

/** With `hasHouse` false (no house connected), nothing of the house: its sections, Gestión, TV. */
export function navLinks(
	webUrl: string | null,
	serviceAdmin = false,
	hasHouse = true,
	kid = false
) {
	if (kid) {
		const links = SECTIONS.filter((s) => KID_SECTIONS.includes(s.path)).map((s) => link(s, webUrl));
		return { links, menuLinks: links, userLinks: [] };
	}
	const links = SECTIONS.filter((s) => hasHouse || (s.where !== 'casa' && !s.house)).map((s) =>
		link(s, webUrl)
	);
	// Not a section to watch or listen to: in the user's menu, as at home; last in the phone's.
	const gestion: NavLink = {
		href: atHome(webUrl, '/library'),
		label: 'Gestión',
		icon: 'gestion',
		external: Boolean(webUrl)
	};
	const userLinks: UserLink[] = [
		{ href: '/ajustes', label: 'Ajustes', icon: 'ajustes' },
		...(hasHouse
			? [
					gestion,
					{
						href: atHome(webUrl, '/tv'),
						label: 'Vista TV',
						icon: 'series' as const,
						external: Boolean(webUrl)
					}
				]
			: []),
		// The families that asked to come in, and the apps entered with the account (#284): only for
		// who runs the service.
		...(serviceAdmin
			? [
					{ href: '/admin/lista-de-espera', label: 'Lista de espera', icon: 'gestion' as const },
					{ href: '/admin/apps', label: 'Apps', icon: 'gestion' as const }
				]
			: [])
	];
	return { links, menuLinks: hasHouse ? [...links, gestion] : links, userLinks };
}
