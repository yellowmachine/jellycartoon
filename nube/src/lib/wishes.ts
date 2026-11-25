/**
 * Lista de deseos (#586), what the page and the server both need: a product's shop by its address,
 * and its price as written.
 */

export const MAX_WISH_TITLE = 300;
export const MAX_WISH_NOTE = 500;
export const MAX_WISH_URL = 2000;

/** For when a wish is, in the list's order; new ones, «pronto». */
export const WISH_PRIORITIES = ['primero', 'pronto', 'mas_adelante'] as const;
export type WishPriority = (typeof WISH_PRIORITIES)[number];
export const WISH_PRIORITY_LABELS: Record<WishPriority, string> = {
	primero: 'Lo primero',
	pronto: 'Pronto',
	mas_adelante: 'Más adelante'
};
export const isWishPriority = (v: unknown): v is WishPriority =>
	WISH_PRIORITIES.includes(v as WishPriority);

/** Shops known by a word of their address, and how they are called. */
const SHOPS: [RegExp, string][] = [
	// Its short links (shared from its app) too, before they are followed.
	[/(^|\.)(amazon\.[a-z.]+|amzn\.[a-z]+|a\.co)$/, 'Amazon'],
	[/(^|\.)aliexpress\.[a-z.]+$/, 'AliExpress'],
	[/(^|\.)elcorteingles\.[a-z.]+$/, 'El Corte Inglés'],
	[/(^|\.)ikea\.[a-z.]+$/, 'IKEA'],
	[/(^|\.)pccomponentes\.[a-z.]+$/, 'PcComponentes'],
	[/(^|\.)mediamarkt\.[a-z.]+$/, 'MediaMarkt'],
	[/(^|\.)decathlon\.[a-z.]+$/, 'Decathlon'],
	[/(^|\.)zara\.[a-z.]+$/, 'Zara'],
	[/(^|\.)mango\.[a-z.]+$/, 'Mango'],
	[/(^|\.)hm\.com$/, 'H&M'],
	[/(^|\.)primark\.[a-z.]+$/, 'Primark'],
	[/(^|\.)leroymerlin\.[a-z.]+$/, 'Leroy Merlin'],
	[/(^|\.)fnac\.[a-z.]+$/, 'Fnac'],
	[/(^|\.)carrefour\.[a-z.]+$/, 'Carrefour'],
	[/(^|\.)lidl\.[a-z.]+$/, 'Lidl'],
	[/(^|\.)worten\.[a-z.]+$/, 'Worten'],
	[/(^|\.)casadellibro\.[a-z.]+$/, 'Casa del Libro'],
	[/(^|\.)(iberlibro|abebooks)\.[a-z.]+$/, 'IberLibro'],
	[/(^|\.)ebay\.[a-z.]+$/, 'eBay'],
	[/(^|\.)(temu\.com|temu\.to)$/, 'Temu'],
	[/(^|\.)shein\.[a-z.]+$/, 'Shein'],
	[/(^|\.)etsy\.[a-z.]+$/, 'Etsy'],
	[/(^|\.)miravia\.[a-z.]+$/, 'Miravia'],
	[/(^|\.)wallapop\.[a-z.]+$/, 'Wallapop'],
	[/(^|\.)toysrus\.[a-z.]+$/, 'Toys "R" Us'],
	[/(^|\.)apple\.com$/, 'Apple'],
	[/(^|\.)(steampowered\.com|s\.team)$/, 'Steam']
];

const hostOf = (address: string) => {
	try {
		const url = new URL(address);
		return /^https?:$/.test(url.protocol) ? url.hostname.toLowerCase() : null;
	} catch {
		return null;
	}
};

/** One of the shops known: «Amazon» for amazon.es and amzn.eu alike. */
export function knownShop(address: string) {
	const host = hostOf(address);
	return host ? (SHOPS.find(([re]) => re.test(host))?.[1] ?? null) : null;
}

/** Its shop: a known one by its name, any other by its address without `www.`. */
export function shopOf(address: string) {
	return knownShop(address) ?? hostOf(address)?.replace(/^www\./, '') ?? 'Tienda';
}

/** «29,99 €», as Spain writes it; null without a price. */
export function priceText(cents: number | null, currency: string | null) {
	if (cents === null) return null;
	try {
		return new Intl.NumberFormat('es-ES', {
			style: 'currency',
			currency: currency || 'EUR'
		}).format(cents / 100);
	} catch {
		return `${(cents / 100).toFixed(2).replace('.', ',')} ${currency ?? ''}`.trim();
	}
}

/** «5,22 € + 12,19 € de envío = 17,41 €», «5,22 €, envío gratis», «5,22 €»; null, nothing known. */
export function costText(w: {
	priceCents: number | null;
	shippingCents?: number | null;
	currency: string | null;
}) {
	const price = priceText(w.priceCents, w.currency);
	const shipping = w.shippingCents ?? null;
	if (shipping === null) return price;
	if (shipping === 0) return price ? `${price}, envío gratis` : 'envío gratis';
	const sending = priceText(shipping, w.currency);
	if (w.priceCents === null) return `envío: ${sending}`;
	return `${price} + ${sending} de envío = ${priceText(w.priceCents + shipping, w.currency)}`;
}

/** Its shipping as it is written to be corrected: «12,19», «gratis», or empty. */
export const shippingField = (cents: number | null | undefined) =>
	cents == null ? '' : cents === 0 ? 'gratis' : (cents / 100).toFixed(2).replace('.', ',');

/** Query parameters that only follow who came from where: out of the address kept. */
const TRACKING =
	/^(utm_.*|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|_ga|_gl|igshid|srsltid|ref|ref_|tag|linkcode|linkid|camp|creative|creativeasin|ascsubtag|spm|scm|pvid|algo_.*|aff_.*|sk|gatewayadapt|_randl_.*|share_.*|social_share)$/i;

/**
 * A product's address as it is kept (#586): Amazon's as `/dp/<ASIN>`, an AliExpress item's without
 * its query, any other without what only tracks. `key`, the same for one product however it was
 * shared (a short link, a long one, another tracking), to tell it is already in a list.
 */
export function cleanLink(address: string): { url: string; key: string } {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		return { url: address, key: `url:${address}` };
	}
	url.hash = '';
	const host = url.hostname.toLowerCase();
	if (knownShop(address) === 'Amazon') {
		const asin = url.pathname.match(
			/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:[/?]|$)/i
		)?.[1];
		if (asin) {
			const id = asin.toUpperCase();
			return { url: `https://${host}/dp/${id}`, key: `amazon:${id}` };
		}
	}
	if (knownShop(address) === 'AliExpress') {
		const item = url.pathname.match(/\/item\/(\d+)\.html/)?.[1];
		if (item) return { url: `https://${host}/item/${item}.html`, key: `aliexpress:${item}` };
	}
	for (const name of [...url.searchParams.keys()])
		if (TRACKING.test(name)) url.searchParams.delete(name);
	const clean = url.href.replace(/\?$/, '');
	return { url: clean, key: `url:${clean.replace(/^https?:\/\/(www\.)?/i, '').toLowerCase()}` };
}

/** «el 22 nov», the day a price was seen: prices change and are not watched. */
export function seenOn(at: Date | string | null) {
	if (!at) return null;
	const day = new Date(at);
	return Number.isNaN(day.getTime())
		? null
		: `el ${day.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '')}`;
}

/**
 * A wish proposed in Preguntar (#586): a link pasted in the chat, read, for whose list. Added with a
 * touch: `added`, its number in the list; `already`, the one that was there.
 */
export interface WishCard {
	kind: 'deseo';
	url: string;
	productKey: string;
	shop: string;
	title: string;
	imageUrl: string | null;
	priceCents: number | null;
	currency: string | null;
	/** Not there in the cards before it. */
	shippingCents?: number | null;
	personId: string;
	personName: string;
	added: number | null;
	already: number | null;
	/** `already`: what it did to its price. */
	change?: PriceChange | null;
}

/**
 * A price as a page shows it to people («29,99 €», «€1.299,00», «$29.99»): in cents and its
 * currency; null if there is no price in it. The last «,» or «.» with one or two digits after it is
 * the decimal one.
 */
export function priceFromText(text: string | null | undefined) {
	const said = (text ?? '')
		.replace(/\u00a0/g, ' ')
		.trim()
		.slice(0, 40);
	const number = said.match(/\d[\d.,\s]*/)?.[0]?.trim();
	if (!number) return null;
	const decimal = number.match(/[.,](\d{1,2})$/);
	const whole = (decimal ? number.slice(0, -decimal[0].length) : number).replace(/[.,\s]/g, '');
	const cents = Number(whole) * 100 + (decimal ? Number(decimal[1]!.padEnd(2, '0')) : 0);
	if (!Number.isFinite(cents) || cents <= 0 || cents >= 100_000_000) return null;
	const currency = /\$/.test(said) ? 'USD' : /£/.test(said) ? 'GBP' : 'EUR';
	return { cents, currency };
}

/** A shipping as written («12,19 €», «gratis», «0»): its currency, null if not said; or null. */
export function shippingFromText(text: string | null | undefined) {
	const said = (text ?? '').replace(/\u00a0/g, ' ').trim();
	if (
		/^(env[ií]o )?(gratis|gratuito|free)$/i.test(said) ||
		/^[€$£]? ?0+([.,]0{1,2})? ?[€$£]?$/.test(said)
	)
		return { cents: 0, currency: null };
	const read = priceFromText(said);
	return read && { cents: read.cents, currency: /[€$£]/.test(said) ? read.currency : null };
}

/** Not said, euros: as they are shown. */
export const sameCurrency = (a: string | null, b: string | null) => (a || 'EUR') === (b || 'EUR');

/** A price as a wish keeps it. */
export interface Price {
	cents: number;
	currency: string | null;
}

/** Who said a price, from the one that counts least: a later one is not replaced by an earlier one. */
export const PRICE_SOURCES = ['servidor', 'marcador', 'mano'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

/**
 * What adding a product again did to its price in the list: `before` null, it had none; `kept`, it
 * stays as it was (by hand, or by the bookmark), though now another is read.
 */
export interface PriceChange {
	before: Price | null;
	now: Price;
	kept?: boolean;
	/** Its shipping, if read too: in cents of `now`'s currency, and `kept` as the price. */
	shipping?: { before: number | null; now: number; kept?: boolean };
}

/** «; envío, de 4,99 € a gratis», after the price's; empty if it is the same. */
function shippingChangeText({ shipping, now }: PriceChange) {
	if (!shipping || shipping.before === shipping.now) return '';
	const said = (cents: number) => (cents ? priceText(cents, now.currency) : 'gratis');
	if (shipping.before === null) return `; envío, ${said(shipping.now)}`;
	return shipping.kept
		? `; envío, ahora se lee ${said(shipping.now)}; se queda en ${said(shipping.before)}`
		: `; envío, de ${said(shipping.before)} a ${said(shipping.now)}`;
}

/** «precio actualizado, de 19,99 € a 13,99 €», after «Ya estaba en la lista». */
export function priceChangeText(change: PriceChange) {
	const { before, now, kept } = change;
	const sending = shippingChangeText(change);
	const to = priceText(now.cents, now.currency);
	const from = before && priceText(before.cents, before.currency);
	if (!from) return `ahora con precio, ${to}${sending}`;
	if (from === to) return `sigue a ${to}${sending}`;
	return kept
		? `ahora se lee ${to}; se queda en ${from}${sending}`
		: `precio actualizado, de ${from} a ${to}${sending}`;
}

/** The same in an address (`1999EUR-1399EUR`, `-1399EUR`, `…-e499.0` its shipping), and back; null if it is not one. */
export const priceChangeParam = ({ before, now, kept, shipping }: PriceChange) =>
	[before, now].map((p) => (p ? `${p.cents}${p.currency ?? ''}` : '')).join('-') +
	(kept ? '-k' : '') +
	(shipping ? `-e${shipping.before ?? ''}.${shipping.now}${shipping.kept ? 'k' : ''}` : '');
export function readPriceChange(param: string | null): PriceChange | null {
	const m = param?.match(
		/^(?:(\d{1,8})([A-Z]{3})?)?-(\d{1,8})([A-Z]{3})?(-k)?(?:-e(\d{1,8})?\.(\d{1,8})(k)?)?$/
	);
	if (!m) return null;
	return {
		before: m[1] ? { cents: Number(m[1]), currency: m[2] ?? null } : null,
		now: { cents: Number(m[3]), currency: m[4] ?? null },
		...(m[5] ? { kept: true } : {}),
		...(m[7]
			? {
					shipping: {
						before: m[6] ? Number(m[6]) : null,
						now: Number(m[7]),
						...(m[8] ? { kept: true } : {})
					}
				}
			: {})
	};
}

/**
 * «5 productos · 3 con precio, 120,50 €»: how many, and what those with a price cost together (each
 * currency on its own), their shipping apart: several of one shop may come together. Some picked `of` a list: «3 de 8 productos · …».
 */
export function wishesSummary(
	list: { priceCents: number | null; currency: string | null; shippingCents?: number | null }[],
	of?: number
) {
	const count = `${of === undefined ? list.length : `${list.length} de ${of}`} ${(of ?? list.length) === 1 ? 'producto' : 'productos'}`;
	if (!list.length) return count;
	const sums = new Map<string, number>();
	const sendings = new Map<string, number>();
	let priced = 0;
	for (const w of list) {
		const { shippingCents } = w;
		if (shippingCents && w.priceCents !== null) {
			const currency = w.currency || 'EUR';
			sendings.set(currency, (sendings.get(currency) ?? 0) + shippingCents);
		}
		if (w.priceCents === null) continue;
		priced++;
		const currency = w.currency || 'EUR';
		sums.set(currency, (sums.get(currency) ?? 0) + w.priceCents);
	}
	if (!priced) return `${count} · sin precio`;
	const told = (m: typeof sums) =>
		[...m].map(([currency, cents]) => priceText(cents, currency)).join(' + ');
	const total = told(sums) + (sendings.size ? `, más ${told(sendings)} de envíos` : '');
	return priced === list.length
		? `${count} · ${total}`
		: `${count} · ${priced} con precio, ${total}`;
}

/**
 * The bookmark's, told by it: an earlier one (dragged before, or from a page not reloaded) is told
 * to be dragged again. One more whenever its code changes (a test checks it).
 */
export const BOOKMARK_VERSION = 4;

/** A shop's page read by the bookmark for «Analizar con IA», at most. */
export const MAX_PAGE_TEXT = 14_000;

/** That text without e-mails or phone numbers, before it is sent and before the AI reads it. */
export const cleanPageText = (text: string) =>
	text
		.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '…')
		.replace(
			/\+\d{2}[ -]?\d{3}(?:[ -]?\d{2,3}){2,3}|(?<![\d.,])[6789]\d{2}(?:[ -]?\d{2,3}){2,3}(?![\d.,])/g,
			'…'
		)
		.trim()
		.slice(0, MAX_PAGE_TEXT);

/** The page's text as the bookmark left it after the address's # (which browsers do not send). */
export function readPageText(hash: string) {
	if (!hash.startsWith('#ia=')) return null;
	try {
		return decodeURIComponent(hash.slice(4)) || null;
	} catch {
		return null;
	}
}

/**
 * What the bookmark takes of the page's text: the options chosen (menus and boxes, never what is
 * typed), what is seen with a price, and the product's text from its name on; without the site's
 * header, menus and footer. One failing leaves the bookmark as if there were none.
 */
const PAGE_TEXT = String.raw`(()=>{try{const D=document,c=s=>(s||'').replace(/\s+/g,' ').trim(),z=e=>!e.closest('nav,footer,script,style,noscript,template,textarea,[contenteditable="true"]')&&!(e.closest('header')&&!e.closest('main')),v=e=>e.getClientRects().length>0,O=[],P=new Set(),T=[];for(const e of D.querySelectorAll('.a-accordion-active'))if(v(e))O.push(c(e.innerText||e.textContent).slice(0,120));for(const e of D.querySelectorAll('select'))if(z(e)&&v(e)&&e.selectedOptions[0])O.push(c((e.labels?.[0]?.textContent||e.getAttribute('aria-label')||e.name||'')+': '+e.selectedOptions[0].text).slice(0,120));for(const e of D.querySelectorAll('input[type="radio"]:checked,input[type="checkbox"]:checked'))if(z(e))O.push(c(e.labels?.[0]?.textContent||e.getAttribute('aria-label')||e.value).slice(0,120));for(const e of D.querySelectorAll('[aria-checked="true"],[aria-pressed="true"],[aria-selected="true"]'))if(z(e)&&v(e))O.push(c(e.getAttribute('aria-label')||e.textContent).slice(0,120));for(const e of D.querySelectorAll('button,[role="button"],[class*="price" i],[id*="price" i],[id*="total" i]'))if(z(e)&&v(e)){const s=c(e.textContent);if(s.length<120&&/\d/.test(s)&&/[€$£]|EUR|USD|GBP/.test(s))P.add(s)}const h=D.querySelector('main h1')||D.querySelector('h1'),w=D.createTreeWalker(D.body,4);let n,l=0;while(l<8000&&(n=w.nextNode())){const e=n.parentElement,s=c(n.data);if(!s||!e||(h&&!h.contains(n)&&h.compareDocumentPosition(n)&2)||!z(e)||!v(e))continue;T.push(s);l+=s.length+1}return'#ia='+encodeURIComponent(('Opciones elegidas:\n'+[...new Set(O)].filter(Boolean).slice(0,40).join('\n').slice(0,2000)+'\n\nPrecios a la vista:\n'+[...P].slice(0,30).join('\n').slice(0,2000)+'\n\nTexto:\n'+T.join('\n').slice(0,8000)).replace(/[\ud800-\udfff]/gu,''))}catch(e){return''}})()`;

/**
 * The price beside the button that buys, when the page declares none (Kobo): from each such button
 * up, the first box with a price seen, not struck through nor of something else (a saving, the
 * postage, a month, a unit); of several, the one in the biggest letters. Two that cannot be told
 * apart, or buttons with different prices (a list of products), none: better empty than another's.
 */
const NEAR_PRICE = String.raw`(()=>{try{const c=s=>(s||'').replace(/\s+/g,' ').trim(),R=/[€$£] ?\d[\d.,]*|\d[\d.,]* ?[€$£]/g,V=e=>e.getClientRects().length>0,L=e=>(c(e.textContent).match(R)||[]),K=(e,top)=>{for(let n=e;n&&n!==top;n=n.parentElement){if(/^(S|DEL)$/.test(n.tagName)||getComputedStyle(n).textDecorationLine.includes('line-through'))return true}return false},N=/ahorr|save|descuento|env[ií]o|shipping|antes|desde|al mes|mensual|month|\/ ?(mes|ud|unidad|kg|l|100)/i,F=new Set();for(const b of document.querySelectorAll('button,[role="button"],input[type="submit"]')){const s=c(b.textContent||b.value);if(!V(b)||s.length>80||!/add to (cart|bag|basket)|buy now|(añadir|agregar) (al|a la|a tu) (carrito|cesta|bolsa)|comprar/i.test(s))continue;for(let t=b.parentElement,i=0;t&&t!==document.body&&i<6;t=t.parentElement,i++){if(c(t.textContent).length>800)break;const A=[...t.querySelectorAll('*')].filter(e=>{const l=c(e.textContent);return l.length<40&&L(e).length===1&&V(e)&&!e.closest('script,style,noscript,template')&&![...e.children].some(k=>L(k).length)&&!N.test(l)&&!K(e,t)}).map(e=>({p:L(e)[0],z:parseFloat(getComputedStyle(e).fontSize)||0})).filter(a=>/[1-9]/.test(a.p));if(!A.length)continue;const z=Math.max(...A.map(a=>a.z)),P=new Set(A.filter(a=>a.z===z).map(a=>a.p));F.add(P.size===1?[...P][0]:'');break}}return F.size===1?[...F][0]:''}catch(e){return''}})()`;

/**
 * What its schema.org offer (of(n), with a price) says sending it to Spain costs, as the server
 * reads it (server/wishes.ts shippingOf): «12.19 €», «gratis», or empty if it is not clear.
 */
const SHIPPING = String.raw`(()=>{try{const A=v=>[].concat(v??[]),N=v=>A(v).filter(n=>n&&typeof n==='object'),f=N(p?.offers).find(n=>[n,...N(n.priceSpecification)].some(of));if(!f)return'';const S=N(f.shippingDetails).length?N(f.shippingDetails):N(p.shippingDetails),C=v=>A(v).map(c=>String(c?.name??c?.identifier??c).trim().toLowerCase()),T=d=>{const D=N(d.shippingDestination);if(!D.length)return 1;return D.some(r=>!(r.addressRegion||r.postalCode||r.postalCodePrefix||r.postalCodeRange)&&C(r.addressCountry).some(c=>['es','esp','spain','españa'].includes(c)))?2:0},L=S.filter(d=>d.doesNotShip!==true&&d.doesNotShip!=='true').map(d=>({d,t:T(d)})),b=L.some(l=>l.t===2)?2:1,M=o.priceCurrency||f.priceCurrency||'EUR',R=new Set(L.filter(l=>l.t===b).map(({d})=>{const r=N(d.shippingRate);if(r.length!==1||d.shippingConditions||d.orderValue||d.weight)return'x';const s=String(r[0].value??'').trim();return(r[0].currency||M)!==M||!/^\d+([.,]\d{1,2})?$/.test(s)?'x':Math.round(Number(s.replace(',','.'))*100)}));if(R.size!==1||R.has('x')||!['EUR','USD','GBP'].includes(M))return'';const c=[...R][0];return c?w2((c/100).toFixed(2),M):'gratis'}catch(e){return''}})()`;

/**
 * The bookmark for a computer's browser (#586): run on a shop's page, it reads what the browser
 * already shows (the page's schema.org Product, as JSON-LD or microdata, and its price tags;
 * Amazon's own title, picture and price, of the buying option chosen, and said in the note if
 * it is second-hand) and opens Seilide's question of a shared link with it.
 * The price in the button that adds it to the cart goes first: of a product made to measure, it is
 * the one of what was chosen, and the others the cheapest's; unless several such buttons say
 * different ones (a list of other products). Nothing is read by the server: a shop that blocks
 * servers (Amazon) is read by the person's own browser. A page that declares no
 * price: NEAR_PRICE. Its shipping: SHIPPING. One that says no picture of its product
 * (Kobo): the one seen with the product's name (its h1) as alternative text, else the biggest near
 * the top. After the #, which browsers do not send, the
 * page's text: it goes to Seilide only with «Analizar con IA».
 */
export function bookmarklet(origin: string) {
	const code = `(()=>{const q=s=>document.querySelector(s),m=n=>q('meta[property="'+n+'"],meta[name="'+n+'"]')?.content,t=e=>e?.textContent?.trim();let p=null;for(const s of document.querySelectorAll('script[type="application/ld+json"]')){try{const w=[JSON.parse(s.textContent)];while(w.length&&!p){const n=w.shift();if(Array.isArray(n))w.push(...n);else if(n&&typeof n==='object'){const y=[].concat(n['@type']);if(y.includes('Product'))p=n;else if(n['@graph'])w.push(n['@graph'])}}}catch(e){}if(p)break}const of=n=>n&&(n.price||n.lowPrice),o=p&&[].concat(p.offers||[]).flatMap(n=>[n,...[].concat(n?.priceSpecification||[])]).find(of),i=p&&[].concat(p.image||[])[0],g=q('#landingImage'),x=n=>{const e=q('[itemtype*="schema.org/Product"] [itemprop="'+n+'"]');return e?.content||t(e)||''},u=x('price')||x('lowPrice'),b=[...new Set([...document.querySelectorAll('button,[role="button"],input[type="submit"]')].filter(e=>e.getClientRects?.().length).map(e=>(e.textContent||e.value||'').replace(/\\s+/g,' ').trim()).filter(s=>s.length<80&&/add to (cart|bag|basket)|(añadir|agregar) (al|a la|a tu) (carrito|cesta|bolsa)|comprar/i.test(s)).map(s=>s.match(/[€$£] ?\\d[\\d.,]*|\\d[\\d.,]* ?[€$£]/)?.[0]).filter(s=>s&&/[1-9]/.test(s)))],w2=(n,c)=>!n?'':/[€$£]/.test(n)?n:n+' '+(c==='USD'?'$':c==='GBP'?'£':'€'),r=q('[id*="ccordionRow"].a-accordion-active'),az=[...(r||document).querySelectorAll('.a-price:not(.a-text-price)')].filter(e=>e.getClientRects?.().length).map(e=>t(e.querySelector('.a-offscreen'))||t(e.querySelector('[aria-hidden]'))).find(Boolean)||'',rt=r&&/used/i.test(r.id)&&r.querySelector('h5,[role="button"],[role="radio"],.a-accordion-row'),pic=()=>{try{const n=s=>(s||'').toLowerCase().replace(/\\s+/g,' ').trim(),h=n(q('h1')?.textContent),c=[...document.querySelectorAll('img')].map(e=>{const b=e.getBoundingClientRect(),s=e.currentSrc||e.src||'';return{s,a:b.width*b.height,k:/^https?:/.test(s)&&b.width>=150&&b.height>=150&&b.width<b.height*3&&b.height<b.width*3&&b.top+scrollY<1500&&e.getClientRects().length&&!e.closest('nav,footer,aside')&&!(e.closest('header')&&!e.closest('main')),h:h&&n(e.alt).includes(h)?1:0}}).filter(e=>e.k).sort((x,y)=>y.h-x.h||y.a-x.a);return c[0]?.s||''}catch(e){return''}},d={url:location.href,titulo:t(q('#productTitle'))||p?.name||m('og:title')||document.title,precio:az||(b.length===1?b[0]:'')||(of(o)?w2(of(o),o.priceCurrency):w2(m('product:price:amount'),m('product:price:currency'))||w2(m('og:price:amount'),m('og:price:currency'))||w2(u,x('priceCurrency')))||${NEAR_PRICE},envio:${SHIPPING},foto:g?.dataset?.oldHires||(g?.dataset?.aDynamicImage&&Object.keys(JSON.parse(g.dataset.aDynamicImage))[0])||(typeof i==='string'?i:i?.url)||m('og:image')||pic()};if(rt)d.nota=(rt.innerText||rt.textContent||'').replace(/\\s+/g,' ').trim().slice(0,80);for(const k in d)d[k]=String(d[k]||'').slice(0,2000);window.open(${JSON.stringify(origin)}+'/compartido/enlace?v=${BOOKMARK_VERSION}&'+new URLSearchParams(d)+${PAGE_TEXT})})()`;
	return `javascript:${encodeURIComponent(code)}`;
}
