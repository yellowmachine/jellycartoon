// The documentation (#380), at docs.seilide.app: Starlight, a static site served by Caddy
// (Dockerfile). The family's guide (guia/, its screenshots by nube/scripts/capturas/, #495) and the
// technical part, from the READMEs.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
// Gruvbox (2026-11-03), cálido y retro: elegido de momento, a falta de lo que diga la familia.
import starlightThemeGruvbox from 'starlight-theme-gruvbox';

const casa = [
	'',
	'desarrollo',
	'produccion',
	'raspberry',
	'rathole',
	'solo-en-casa',
	'series',
	'etiquetas',
	'cine',
	'musica',
	'snapcast',
	'modo-dj',
	'voces',
	'accesos-directos',
	'juegos',
	'radio',
	'carretera',
	'voz',
	'privacidad',
	'copias',
	'actualizaciones',
	'licencia',
	'pendiente'
];
const seilide = [
	'',
	'desarrollo',
	'produccion',
	'series',
	'musica',
	'carretera',
	'privacidad-gastos'
];
const guia = ['', 'dinero', 'agenda', 'nevera', 'recetas', 'carretera', 'musica'];
const pages = (base, slugs) => slugs.map((s) => (s ? `${base}/${s}` : base));

export default defineConfig({
	site: 'https://docs.seilide.app',
	integrations: [
		starlight({
			// A link to a page or a heading that does not exist fails the build; and the Gruvbox theme.
			plugins: [starlightLinksValidator(), starlightThemeGruvbox()],
			title: 'JellyCartoon y Seilide',
			defaultLocale: 'root',
			locales: { root: { label: 'Español', lang: 'es' } },
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/yellowmachine/jellycartoon'
				}
			],
			editLink: { baseUrl: 'https://github.com/yellowmachine/jellycartoon/edit/main/docs/' },
			sidebar: [
				{ label: 'Guía de Seilide', items: pages('guia', guia) },
				{ label: 'JellyCartoon, la casa', items: pages('tecnica/casa', casa) },
				{ label: 'Seilide, la nube', items: pages('tecnica/seilide', seilide) },
				{ label: 'Satélite de voz', items: ['tecnica/satelite'] }
			]
		})
	]
});
