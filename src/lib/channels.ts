/**
 * TV channels, live: the streams each broadcaster gives away on its own CDN, as listed by
 * TDTChannels (https://www.tdtchannels.com). Open, with no sign-in, playable from Spain and in a
 * browser (CORS). Those only on FAST platforms (Samsung TV Plus, Xumo…) are left out: their links
 * change, and their ad segments have no extension, which mpv's FFmpeg refuses.
 */

export interface Channel {
	id: string;
	name: string;
	description: string;
	/** HLS. */
	url: string;
	/** Its brand's, as a hex `#rrggbb`: a soft wash behind its card. */
	color: string;
	/** Children's accounts can watch it too, within their time. */
	kids?: boolean;
}

export const CHANNELS: Channel[] = [
	{
		id: 'la1',
		name: 'La 1',
		description: 'Informativos, series y concursos',
		url: 'https://rtvelivestream.rtve.es/rtvesec/la1/la1_main_dvr.m3u8',
		color: '#e30613'
	},
	{
		id: 'la2',
		name: 'La 2',
		description: 'Documentales, cine y cultura',
		url: 'https://rtvelivestream.rtve.es/rtvesec/la2/la2_main_dvr.m3u8',
		color: '#6d2e8f'
	},
	{
		id: '24h',
		name: '24h',
		description: 'Noticias a todas horas',
		url: 'https://rtvelivestream.rtve.es/rtvesec/24h/24h_main_dvr.m3u8',
		color: '#0099d8'
	},
	{
		id: 'teledeporte',
		name: 'Teledeporte',
		// What it has no rights to show on the internet is a notice instead, even when on the air.
		description: 'Deportes; algunas retransmisiones solo por antena',
		url: 'https://rtvelivestream.rtve.es/rtvesec/tdp/tdp_main.m3u8',
		color: '#00a650'
	},
	{
		id: 'clan',
		name: 'Clan',
		description: 'Dibujos y series infantiles',
		url: 'https://rtvelivestream.rtve.es/rtvesec/clan/clan_main_dvr.m3u8',
		color: '#ff8200',
		kids: true
	},
	{
		id: 'sx3',
		name: 'SX3',
		description: 'Dibujos y series infantiles, en catalán',
		url: 'https://directes-tv-cat.3catdirectes.cat/live-content/super3-hls/master.m3u8',
		color: '#e5007d',
		kids: true
	},
	{
		id: 'tve-internacional',
		name: 'TVE Internacional',
		description: 'Lo mejor de La 1 y La 2, para Europa',
		url: 'https://rtvelivestream.rtve.es/rtvesec/int/tvei_eu_main_dvr.m3u8',
		color: '#c8102e'
	},
	{
		id: 'star-tve',
		name: 'Star TVE',
		description: 'Series y cine españoles',
		url: 'https://rtvelivestream.rtve.es/rtvesec/int/star_main_dvr.m3u8',
		color: '#f2a900'
	},
	{
		id: 'dw-es',
		name: 'DW Español',
		description: 'Noticias y reportajes desde Alemania',
		url: 'https://dwamdstream104.akamaized.net/hls/live/2015530/dwstream104/index.m3u8',
		color: '#0a8fd8'
	},
	{
		id: 'france24-es',
		name: 'France 24 Español',
		description: 'Noticias internacionales desde París',
		url: 'https://live.france24.com/hls/live/2037220/F24_ES_HI_HLS/master_5000.m3u8',
		color: '#e2001a'
	},
	{
		id: 'dw-en',
		name: 'DW English',
		description: 'News and documentaries, with English subtitles',
		url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
		color: '#0a8fd8'
	},
	{
		id: 'france24-en',
		name: 'France 24 English',
		description: 'International news from Paris',
		url: 'https://live.france24.com/hls/live/2037218/F24_EN_HI_HLS/master_5000.m3u8',
		color: '#e2001a'
	},
	{
		id: 'cbs-news',
		name: 'CBS News',
		description: 'American news, around the clock',
		url: 'https://cbsn-us.cbsnstream.cbsnews.com/out/v1/55a8648e8f134e82a470f83d562deeca/master.m3u8',
		color: '#2f6fed'
	},
	{
		id: 'bloomberg-us',
		name: 'Bloomberg',
		description: 'Business and markets, from New York',
		url: 'https://www.bloomberg.com/media-manifest/streams/us.m3u8',
		color: '#8a2be2'
	},
	{
		id: 'cheddar',
		name: 'Cheddar',
		description: 'Tech, business and culture news',
		url: 'https://hls.livecdn.io/cheddar.com/cheddar/playlist.m3u8',
		color: '#f7c600'
	},
	{
		id: 'abc-news-au',
		name: 'ABC News Australia',
		description: 'Australian public news, with English subtitles',
		url: 'https://abc-news-dmd-streams-1.akamaized.net/out/v1/abc83881886746b0802dc3e7ca2bc792/index.m3u8',
		color: '#ffb81c'
	},
	{
		id: 'france24-fr',
		name: 'France 24 Français',
		description: "L'actualité internationale, depuis Paris",
		url: 'https://live.france24.com/hls/live/2037179/F24_FR_HI_HLS/master_5000.m3u8',
		color: '#e2001a'
	}
];

/** Its card's background: its color, fading out. */
export const channelWash = (c: Channel) =>
	`linear-gradient(to right, ${c.color}40, transparent 75%)`;

/** The channels this account can watch: a child's, only those for children. */
export const channelsFor = (kid: boolean) => CHANNELS.filter((c) => !kid || c.kids);
