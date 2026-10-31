import type { NavLink, UserLink } from 'comun/components/SiteNav.svelte';
import type { Section } from 'comun/components/SectionIcon.svelte';

/**
 * The bar's sections, as jellycartoon's and in its order (#253): in the cloud (its page here), or
 * still at home but moving here (`pendiente`: a page that says so, with the way to it at home).
 * The house's for good (Cine, Salón, Juegos, Infantil, Gestión) are not here: each one knows where
 * they are, as the house's bar has nothing of the cloud. `house`: nothing in it without a house
 * connected (Ajustes), as a family that uses only the cloud: not in its bar.
 */
type Where = 'nube' | 'pendiente';

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
	{ path: '/musica', label: 'Música', icon: 'musica', where: 'nube', house: true },
	{ path: '/radio', label: 'Radio', icon: 'radio', where: 'nube' },
	{ path: '/canales', label: 'Canales', icon: 'canales', where: 'nube' },
	{ path: '/recetas', label: 'Recetas', icon: 'recetas', where: 'nube' },
	{ path: '/nevera', label: 'Nevera', icon: 'nevera', where: 'nube' },
	{ path: '/agenda', label: 'Agenda', icon: 'agenda', where: 'nube' },
	{ path: '/gastos', label: 'Gastos', icon: 'gastos', where: 'nube' },
	{ path: '/viajes', label: 'Viajes', icon: 'viajes', where: 'nube', also: ['/carretera'] },
	// Homework from the cartoons watched at the house (#142), for the grown-ups and the children.
	{ path: '/deberes', label: 'Deberes', icon: 'infantil', where: 'nube', house: true }
];

/** Those still at home but moving here: each has its page saying so ([seccion=pendiente]). */
export const PENDING = SECTIONS.filter((s) => s.where === 'pendiente').map((s) => s.path.slice(1));

/** Where a section of the house is: jellycartoon itself, or a page asking for its address. */
export const atHome = (webUrl: string | null, path: string) =>
	webUrl ? `${webUrl}${path === '/series' ? '/' : path}` : `/en-casa${path}`;

const link = (s: (typeof SECTIONS)[number]): NavLink => ({
	href: s.path,
	label: s.label,
	icon: s.icon,
	also: s.also
});

/** What a child's bar has (#303): what it may open (kids.ts), and no Ajustes. */
const KID_SECTIONS = ['/series', '/musica', '/deberes', '/agenda', '/nevera'];

/** With `hasHouse` false (no house connected), nothing of the house. */
export function navLinks(serviceAdmin = false, hasHouse = true, kid = false, guardian = false) {
	const links = SECTIONS.filter(
		(s) => (!kid || KID_SECTIONS.includes(s.path)) && (hasHouse || !s.house)
	).map(link);
	if (kid) return { links, menuLinks: links, userLinks: [] };
	const userLinks: UserLink[] = [
		// What the app told them and the messages left for them (#331).
		{ href: '/buzon', label: 'Buzón', icon: 'agenda' },
		{ href: '/ajustes', label: 'Ajustes', icon: 'ajustes' },
		// Their phone, handed to one of their children (#303).
		...(guardian ? [{ href: '/pasar', label: 'Pasar a un peque', icon: 'infantil' as const }] : []),
		// Who runs the service: its families, its copies, the waiting list and the apps (/admin).
		...(serviceAdmin ? [{ href: '/admin', label: 'Admin', icon: 'gestion' as const }] : [])
	];
	return { links, menuLinks: links, userLinks };
}
