/**
 * News aggregation for the "new products · news" panel.
 *
 * The official sites no longer publish RSS (bandai-hobby.net/feed/ is a 404
 * page, en.gundam.info/rss redirects to the GUNDAM OFFICIAL home page), so
 * each source declares how its page is read:
 *   - 'bandai-html'  bandai-hobby.net/news/ — server-rendered news list
 *   - 'next-news'    en.gundam-official.com/news — Next.js page whose embedded
 *                    data payload carries the news list (newsResponse.data)
 *   - 'rss'          any RSS 2.0 / Atom feed (generic; for extra sources)
 *
 * Output items match what js/notifications.js expects:
 *   { title, link, ts, source, icon, img, kind }
 * kind: 'product' (new kit / release info) | 'shop' (pre-order) | 'news'
 */

import { fetchText, cleanText } from './net.js';

export const SOURCES = [
    { name: 'Bandai Hobby', url: 'https://bandai-hobby.net/news/', type: 'bandai-html', icon: '🆕' },
    { name: 'GUNDAM OFFICIAL', url: 'https://en.gundam-official.com/news', type: 'next-news', icon: '📡' }
];

const ACCEPT = {
    'bandai-html': 'text/html',
    'next-news': 'text/html',
    rss: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5'
};

const isHttp = u => typeof u === 'string' && /^https?:\/\//i.test(u);

/**
 * Fetch every source, merge, sort newest first, drop duplicate links.
 * Never throws: a dead source is reported in `sources` and skipped.
 */
export async function aggregateNews({ limit = 50, sources = SOURCES, timeoutMs = 8000 } = {}) {
    const results = await Promise.allSettled(sources.map(src => fetchSource(src, { timeoutMs })));

    const status = [];
    let items = [];
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            status.push({ name: sources[i].name, ok: true, count: r.value.length });
            items = items.concat(r.value);
        } else {
            status.push({ name: sources[i].name, ok: false, count: 0, error: String(r.reason?.message || r.reason) });
        }
    });

    items.sort((a, b) => b.ts - a.ts);
    const seen = new Set();
    items = items.filter(i => (seen.has(i.link) ? false : seen.add(i.link)));

    return { fetchedAt: Date.now(), sources: status, items: items.slice(0, limit) };
}

export async function fetchSource(source, { timeoutMs = 8000 } = {}) {
    const text = await fetchText(source.url, { timeoutMs, attempts: 2, headers: { Accept: ACCEPT[source.type] || '*/*' } });
    const items = parseSource(text, source);
    if (!items.length) throw new Error('no_items_parsed');
    return items;
}

export function parseSource(text, source) {
    switch (source.type) {
        case 'bandai-html': return parseBandaiNews(text, source);
        case 'next-news': return parseNextNews(text, source);
        default: return parseFeed(text, source);
    }
}

function item(source, { title, link, ts, img = '', kind = 'news' }) {
    if (!title || !isHttp(link)) return null;
    return { title, link, ts: Number.isFinite(ts) ? ts : 0, source: source.name, icon: source.icon, img: isHttp(img) ? img : '', kind };
}

// ---------------------------------------------------------------- Bandai Hobby

const BANDAI_KIND = { 新商品: 'product', オンラインショップ: 'shop', トピックス: 'news' };

/**
 * bandai-hobby.net/news/: <li class="pg-news__list p-newslist__list" data-group="…">
 * with a link, a tag (新商品 / オンラインショップ / トピックス), a date
 * "2026年10月01日 (木)" (Japan time, no clock) and a title
 */
export function parseBandaiNews(html, source) {
    const out = [];
    const chunks = String(html).split(/<li class="[^"]*p-newslist__list[^"]*"/).slice(1);
    for (const chunk of chunks) {
        const link = /<a href="([^"]+)"/.exec(chunk)?.[1];
        const title = cleanText(/class="[^"]*p-newslist__tit[^"]*">([\s\S]*?)<\/div>/.exec(chunk)?.[1]);
        const tag = cleanText(/class="[^"]*p-newslist__tag[^"]*">([\s\S]*?)<\/div>/.exec(chunk)?.[1]);
        const date = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/.exec(chunk);
        // midnight JST (UTC+9)
        const ts = date ? Date.UTC(+date[1], +date[2] - 1, +date[3]) - 9 * 60 * 60 * 1000 : 0;
        const img = /<div class="[^"]*p-newslist__img[^"]*">\s*<img[^>]*src="([^"]+)"/.exec(chunk)?.[1];
        const entry = item(source, { title, link: cleanText(link), ts, img: img ? cleanText(img) : '', kind: BANDAI_KIND[tag] || 'news' });
        if (entry) out.push(entry);
    }
    return out;
}

// ---------------------------------------------------------------- GUNDAM OFFICIAL

/**
 * Next.js App Router pages stream their data as
 *   <script>self.__next_f.push([1,"<JSON string chunk>"])</script>
 * Concatenating the decoded chunks gives the payload text, which contains
 * `"newsResponse":{"data":[{ documentId, title, displayDatetime, url, thumbnail, categories }]}`.
 */
export function parseNextNews(html, source) {
    const payload = [...String(html).matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
        .map(m => { try { return JSON.parse(`"${m[1]}"`); } catch { return ''; } })
        .join('');
    const data = extractJsonObject(payload, '"newsResponse":')?.data;
    if (!Array.isArray(data)) return [];

    return data.map(n => {
        const categories = (n.categories || []).map(c => String(c?.name || '').toUpperCase());
        return item(source, {
            title: cleanText(n.title),
            link: n.url || (n.documentId ? `https://en.gundam-official.com/news/${n.documentId}` : ''),
            ts: Date.parse(n.displayDatetime),
            img: n.thumbnail?.url,
            kind: gundamOfficialKind(categories, n.title)
        });
    }).filter(Boolean);
}

/**
 * Only GUNPLA-category posts can be kit news; events held at a Gundam Base
 * and campaigns/surveys stay plain news
 */
function gundamOfficialKind(categories, title = '') {
    if (!categories.includes('GUNPLA') || categories.includes('EVENTS')) return 'news';
    if (/pre-?orders?/i.test(title)) return 'shop';
    if (/line-?up|releas|launch|announce|reveal|arriv|\bnew\b/i.test(title)) return 'product';
    return 'news';
}

/**
 * The JSON object that follows `key` in `text` (string-aware brace matching)
 */
function extractJsonObject(text, key) {
    const at = text.indexOf(key);
    if (at < 0) return null;
    const start = text.indexOf('{', at + key.length);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) {
            try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
        }
    }
    return null;
}

// ---------------------------------------------------------------- RSS / Atom

/**
 * Tolerant tag-level RSS 2.0 <item> / Atom <entry> reader (Workers have no
 * DOMParser): CDATA, HTML entities and namespaced date tags are handled.
 */
export function parseFeed(xml, source) {
    const out = [];
    const blocks = matchBlocks(xml, 'item').concat(matchBlocks(xml, 'entry'));

    for (const block of blocks) {
        const dateStr = cleanText(pickTag(block, ['pubDate', 'published', 'updated', 'dc:date']));
        const entry = item(source, {
            title: cleanText(pickTag(block, ['title'])),
            link: pickLink(block),
            ts: dateStr ? Date.parse(dateStr) : 0,
            img: pickImage(block)
        });
        if (entry) out.push(entry);
    }
    return out;
}

function matchBlocks(xml, tag) {
    const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
    const blocks = [];
    let m;
    while ((m = re.exec(xml)) !== null) blocks.push(m[1]);
    return blocks;
}

function pickTag(block, tags) {
    for (const tag of tags) {
        const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
        const m = re.exec(block);
        if (m && m[1]) return m[1];
    }
    return '';
}

function pickLink(block) {
    // RSS: <link>https://…</link>
    const text = cleanText(pickTag(block, ['link']));
    if (isHttp(text)) return text;

    // Atom: <link rel="alternate" href="…"/> — prefer alternate, else first href
    const tags = block.match(/<link\b[^>]*>/gi) || [];
    let fallback = '';
    for (const tag of tags) {
        const hrefMatch = /href=["']([^"']+)["']/i.exec(tag);
        if (!hrefMatch) continue;
        const relMatch = /rel=["']([^"']+)["']/i.exec(tag);
        const rel = relMatch ? relMatch[1] : '';
        if (rel === '' || rel === 'alternate') return hrefMatch[1];
        if (!fallback) fallback = hrefMatch[1];
    }
    return fallback;
}

function pickImage(block) {
    const enclosure = /<enclosure\b[^>]*url=["']([^"']+)["']/i.exec(block);
    if (enclosure) return enclosure[1];
    const media = /<media:(?:thumbnail|content)\b[^>]*url=["']([^"']+)["']/i.exec(block);
    if (media) return media[1];
    const desc = pickTag(block, ['description', 'summary', 'content:encoded', 'content'])
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    const img = /<img\b[^>]*src=["']([^"']+)["']/i.exec(desc);
    return img ? img[1] : '';
}
