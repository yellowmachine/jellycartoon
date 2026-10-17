/**
 * TV channels, live: the streams RTVE gives away on its own CDN, as listed by TDTChannels
 * (https://www.tdtchannels.com). Open, with no sign-in; most also have the original version and
 * subtitles. Other channels keep theirs inside their own platforms.
 */

export interface Channel {
	id: string;
	name: string;
	description: string;
	/** HLS. */
	url: string;
	/** Children's accounts can watch it too, within their time. */
	kids?: boolean;
}

export const CHANNELS: Channel[] = [
	{
		id: 'la1',
		name: 'La 1',
		description: 'Informativos, series y concursos',
		url: 'https://rtvelivestream.rtve.es/rtvesec/la1/la1_main_dvr.m3u8'
	},
	{
		id: 'la2',
		name: 'La 2',
		description: 'Documentales, cine y cultura',
		url: 'https://rtvelivestream.rtve.es/rtvesec/la2/la2_main_dvr.m3u8'
	},
	{
		id: '24h',
		name: '24h',
		description: 'Noticias a todas horas',
		url: 'https://rtvelivestream.rtve.es/rtvesec/24h/24h_main_dvr.m3u8'
	},
	{
		id: 'teledeporte',
		name: 'Teledeporte',
		// What it has no rights to show on the internet is a notice instead, even when on the air.
		description: 'Deportes; algunas retransmisiones solo por antena',
		url: 'https://rtvelivestream.rtve.es/rtvesec/tdp/tdp_main.m3u8'
	},
	{
		id: 'clan',
		name: 'Clan',
		description: 'Dibujos y series infantiles',
		url: 'https://rtvelivestream.rtve.es/rtvesec/clan/clan_main_dvr.m3u8',
		kids: true
	}
];

/** The channels this account can watch: a child's, only those for children. */
export const channelsFor = (kid: boolean) => CHANNELS.filter((c) => !kid || c.kids);
