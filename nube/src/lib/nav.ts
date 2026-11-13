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
	/** Only with Oración on (#339, Ajustes → Familia → Secciones). */
	prayer?: true;
	/** Out of the bar until the family turns it on. */
	startsOff?: true;
	/** Said in Ajustes, under its name. */
	about?: string;
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
	// Calls between the family (#330): whom to call, and the history.
	{ path: '/llamadas', label: 'Llamadas', icon: 'llamadas', where: 'nube', also: ['/llamada'] },
	{ path: '/gastos', label: 'Dinero', icon: 'gastos', where: 'nube' },
	{ path: '/papeles', label: 'Papeles', icon: 'papeles', where: 'nube' },
	{ path: '/viajes', label: 'Viajes', icon: 'viajes', where: 'nube', also: ['/carretera'] },
	{
		path: '/paseos',
		label: 'Paseos',
		icon: 'paseos',
		where: 'nube',
		startsOff: true,
		about: 'Tiempo, km y recorrido al salir a andar, privados de cada persona. Solo adultos.'
	},
	// A chat with the family's AI (#470), each adult their own; children have none.
	{
		path: '/preguntar',
		label: 'Preguntar',
		icon: 'preguntar',
		where: 'nube',
		about:
			'Un chat con la IA, privado de cada persona, que propone qué comprar o una receta para guardar con un toque. Solo adultos.'
	},
	// Rules and what the voice remembers (#331, #389), out of Ajustes: adults only.
	{
		path: '/reglas',
		label: 'Reglas',
		icon: 'reglas',
		where: 'nube',
		about:
			'Avisos que se dicen con palabras («si alguien pone leche en la lista, avísame»), «¿Qué pasaría…?» y lo que la voz recuerda. Solo adultos.'
	},
	{
		path: '/notas',
		label: 'Notas',
		icon: 'notas',
		where: 'nube',
		about: 'Notas dictadas, privadas de cada persona, para buscarlas luego. Solo adultos.'
	},
	// Smart plugs (#396): Shelly plugs that connect to Seilide by themselves.
	{
		path: '/enchufes',
		label: 'Enchufes',
		icon: 'enchufes',
		where: 'nube',
		startsOff: true,
		about: 'Encender y apagar aparatos desde fuera y ver cuánto gastan, con enchufes Shelly.'
	},
	// Homework from the cartoons watched at the house (#142), for the grown-ups and the children.
	{
		path: '/deberes',
		label: 'Deberes',
		icon: 'infantil',
		where: 'nube',
		house: true,
		startsOff: true,
		about: 'Deberes sobre los dibujos que ven los peques en casa.'
	},
	{
		path: '/juegos',
		label: 'Juegos',
		icon: 'juegos',
		where: 'nube',
		house: true,
		startsOff: true,
		about:
			'Los juegos retro de la casa, en el navegador: las mismas partidas que en la tele. Solo adultos.'
	},
	// What is watched at home (#421), from a copy the house sends: adults only.
	{
		path: '/estadisticas',
		label: 'Estadísticas',
		icon: 'estadisticas',
		where: 'nube',
		house: true,
		startsOff: true,
		about:
			'Cuántas horas se ve en casa, por persona y por serie, y a qué horas. Cada adulto ve las suyas y las de los peques. Solo adultos.'
	},
	{
		path: '/oracion',
		label: 'Oración',
		icon: 'oracion',
		where: 'nube',
		prayer: true,
		about:
			'Para pegar oraciones y letanías, darles voz con la IA y rezarlas en listas. Los peques solo las escuchan. Apagada, tampoco se abre.'
	}
];

/** What the family chose in Ajustes, section by section; one it never touched goes by its default. */
export type SectionChoices = Record<string, boolean>;

const chosen = (s: (typeof SECTIONS)[number], saved: SectionChoices) =>
	saved[s.path] ?? !s.startsOff;

/**
 * Each adult's own bar, among what the family has (Ajustes → Para mí → «Mi barra»): one they never
 * touched, out if the family has it. Children have none: theirs is the family's.
 */
const mineOn = (path: string, mine: SectionChoices) => mine[path] ?? true;

/** Out for this person: the family has it, and they did not take it out of their bar. */
const shown = (
	s: (typeof SECTIONS)[number],
	saved: SectionChoices,
	prayer: boolean,
	mine: SectionChoices
) => (s.prayer ? prayer : chosen(s, saved)) && mineOn(s.path, mine);

/** Whether this person has this section out: for the bar, and for its card on the home page. */
export const sectionOn = (path: string, saved: SectionChoices = {}, mine: SectionChoices = {}) => {
	const s = SECTIONS.find((x) => x.path === path);
	return s ? chosen(s, saved) && mineOn(path, mine) : true;
};

/** Ajustes' list: without a house, nothing of it (as in the bar). Oración, with its own on or off. */
export const sectionList = (hasHouse: boolean, saved: SectionChoices, prayer: boolean) =>
	SECTIONS.filter((s) => hasHouse || !s.house).map((s) => ({
		path: s.path,
		label: s.label,
		about: s.about,
		on: s.prayer ? prayer : chosen(s, saved)
	}));

/**
 * What to keep from Ajustes' form, whose ticked ones are `ticked`: those it showed, and as they
 * were those it did not (a house's, without a house now). Oración is not here: its own on or off.
 */
export function savedSections(hasHouse: boolean, before: SectionChoices, ticked: string[]) {
	const after = { ...before };
	for (const s of SECTIONS)
		if (!s.prayer && (hasHouse || !s.house)) after[s.path] = ticked.includes(s.path);
	return after;
}

/** «Mi barra»: what the family has (with or without a house, Oración by its own on), each as theirs. */
export const mySectionList = (
	hasHouse: boolean,
	saved: SectionChoices,
	prayer: boolean,
	mine: SectionChoices
) =>
	SECTIONS.filter((s) => (hasHouse || !s.house) && (s.prayer ? prayer : chosen(s, saved))).map(
		(s) => ({ path: s.path, label: s.label, on: mineOn(s.path, mine) })
	);

/**
 * What to keep from «Mi barra», whose ticked ones are `ticked` among the `shown` it had: the rest as
 * they were, so a section the family turns off and on again comes back as the person left it.
 */
export function savedMine(before: SectionChoices, shown: string[], ticked: string[]) {
	const after = { ...before };
	for (const s of SECTIONS) if (shown.includes(s.path)) after[s.path] = ticked.includes(s.path);
	return after;
}

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
const KID_SECTIONS = [
	'/series',
	'/musica',
	'/deberes',
	'/agenda',
	'/nevera',
	'/llamadas',
	'/oracion'
];

/**
 * With `hasHouse` false (no house connected), nothing of the house; `prayer`, Oración's on;
 * `sections`, what the family has out (Ajustes); `mine`, what this adult took out of their own
 * bar (a child's is the family's). Only the bar: their pages still open.
 */
export function navLinks(
	serviceAdmin = false,
	hasHouse = true,
	kid = false,
	guardian = false,
	prayer = false,
	sections: SectionChoices = {},
	mine: SectionChoices = {}
) {
	const links = SECTIONS.filter(
		(s) =>
			(!kid || KID_SECTIONS.includes(s.path)) &&
			(hasHouse || !s.house) &&
			shown(s, sections, prayer, kid ? {} : mine)
	).map(link);
	if (kid) return { links, menuLinks: links, userLinks: [] };
	const userLinks: UserLink[] = [
		// A QR read to let someone in (/qr): a child on its device (#303), for who lets some child in;
		// oneself on the house's TV (#172), with a house.
		...(guardian || hasHouse
			? [
					{
						href: '/qr',
						label: 'Leer un QR',
						icon: guardian ? ('infantil' as const) : ('salon' as const)
					}
				]
			: []),
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
