/**
 * Radio stations from around the world, to listen to and to learn languages with. Chosen by hand
 * and kept as their Radio Browser ids (https://www.radio-browser.info): the stream itself is asked
 * for when one is played, so a station that changes its stream keeps working once the community
 * updates it there.
 */

export type RadioLanguage = 'en' | 'fr' | 'it' | 'es';

export interface RadioStation {
	/** `stationuuid` in Radio Browser. */
	uuid: string;
	name: string;
	language: RadioLanguage;
	/** ISO 3166-1 alpha-2. */
	country: string;
	/** Talk (news, culture) is the best for the ear; music, for a while. */
	kind: 'talk' | 'music';
	description: string;
}

/** Spoken ones first in each language. */
export const STATIONS: RadioStation[] = [
	{
		uuid: '598c4d0e-6b06-43fb-bff4-717c591213a9',
		name: 'BBC World Service',
		language: 'en',
		country: 'GB',
		kind: 'talk',
		description: 'Noticias y reportajes de todo el mundo'
	},
	{
		uuid: '98137c2d-ce68-4e33-8cb7-ddf3692ecc9d',
		name: 'BBC Radio 4',
		language: 'en',
		country: 'GB',
		kind: 'talk',
		description: 'Noticias, documentales, teatro y humor'
	},
	{
		uuid: '7ba4c184-fc2b-11e9-bbf2-52543be04c81',
		name: 'NPR',
		language: 'en',
		country: 'US',
		kind: 'talk',
		description: 'La radio pública de Estados Unidos'
	},
	{
		uuid: '535d3971-0a8f-4ccd-9dbe-2444bc7d339b',
		name: 'WNYC',
		language: 'en',
		country: 'US',
		kind: 'talk',
		description: 'Radio pública de Nueva York'
	},
	{
		uuid: '3606ef8c-cd58-4440-8c47-dbf1e0cacdac',
		name: 'BBC Radio 2',
		language: 'en',
		country: 'GB',
		kind: 'music',
		description: 'Pop, rock y clásicos'
	},
	{
		uuid: '0b80555f-eb5c-4fce-94d2-109eec7bee6b',
		name: 'France Inter',
		language: 'fr',
		country: 'FR',
		kind: 'talk',
		description: 'Actualidad, entrevistas y magacines'
	},
	{
		uuid: '5515db8e-8d5e-4f11-a923-f41fef8b7032',
		name: 'France Culture',
		language: 'fr',
		country: 'FR',
		kind: 'talk',
		description: 'Cultura, historia, ciencia y debates'
	},
	{
		uuid: '0e9765da-71c6-41b5-b358-dddab24e302b',
		name: 'franceinfo',
		language: 'fr',
		country: 'FR',
		kind: 'talk',
		description: 'Noticias las 24 horas'
	},
	{
		uuid: 'cbca0f46-ced9-4154-8157-c87039765207',
		name: 'RFI Monde',
		language: 'fr',
		country: 'FR',
		kind: 'talk',
		description: 'Radio France Internationale: noticias del mundo'
	},
	{
		uuid: '7b6aca3d-dfa3-47dd-9f57-820b04c3f339',
		name: 'FIP',
		language: 'fr',
		country: 'FR',
		kind: 'music',
		description: 'Música ecléctica, casi sin locución'
	},
	{
		uuid: '7bd0a378-7d60-4363-8699-764af50f30c7',
		name: 'Rai Radio 1',
		language: 'it',
		country: 'IT',
		kind: 'talk',
		description: 'Noticias, deporte y actualidad'
	},
	{
		uuid: '9608eb3e-0601-11e8-ae97-52543be04c81',
		name: 'Rai Radio 3',
		language: 'it',
		country: 'IT',
		kind: 'talk',
		description: 'Cultura y música clásica'
	},
	{
		uuid: '6b0c9901-ae10-4f5e-a5cf-b40319512633',
		name: 'Rai Radio 2',
		language: 'it',
		country: 'IT',
		kind: 'music',
		description: 'Entretenimiento y música'
	},
	{
		uuid: '4a629927-b026-4cea-a093-4cf44ec69af5',
		name: 'RNE Radio Nacional',
		language: 'es',
		country: 'ES',
		kind: 'talk',
		description: 'Actualidad, cultura y magacines'
	},
	{
		uuid: '5d6b5573-d661-477a-82fc-1d0d03799679',
		name: 'RNE Radio 5',
		language: 'es',
		country: 'ES',
		kind: 'talk',
		description: 'Noticias las 24 horas'
	},
	{
		uuid: '692a3b69-0f68-11ea-a87e-52543be04c81',
		name: 'Cadena SER',
		language: 'es',
		country: 'ES',
		kind: 'talk',
		description: 'Actualidad y tertulias'
	},
	{
		uuid: 'd8b6ba19-f431-471e-9598-94f42af0d3ac',
		name: 'RNE Radio 3',
		language: 'es',
		country: 'ES',
		kind: 'music',
		description: 'Música alternativa y nuevas propuestas'
	},
	{
		uuid: 'da69613a-bae9-4492-aab9-fb96b48249b5',
		name: 'Radio Clásica',
		language: 'es',
		country: 'ES',
		kind: 'music',
		description: 'Música clásica'
	}
];

export const LANGUAGES: { code: RadioLanguage; label: string }[] = [
	{ code: 'en', label: 'Inglés' },
	{ code: 'fr', label: 'Francés' },
	{ code: 'it', label: 'Italiano' },
	{ code: 'es', label: 'Español' }
];

export const COUNTRIES: Record<string, string> = {
	GB: 'Reino Unido',
	US: 'Estados Unidos',
	FR: 'Francia',
	IT: 'Italia',
	ES: 'España'
};

/** What Radio Browser says of a station now; missing when it could not be asked. */
export interface RadioStationInfo {
	favicon: string | null;
	/** It worked in Radio Browser's last check. */
	ok: boolean;
}

/** A station to play: where its stream is right now. */
export interface RadioStream {
	uuid: string;
	name: string;
	country: string;
	favicon: string | null;
	url: string;
	hls: boolean;
}
