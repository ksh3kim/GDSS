/**
 * Gunpla Guide — Serverless API (Cloudflare Worker)
 *
 * Runtime backend layer separated out of the static web app. Moves backend-ish
 * work off the client and away from unreliable public CORS proxies:
 *
 *   GET /api/news?limit=20   Aggregated Bandai Hobby / GUNDAM.INFO news:
 *                            server-side fetch + parse + merge + edge cache
 *   GET /api/health          Liveness probe
 *
 * Layer boundaries (for maintainers):
 *   - RSS aggregation + cache refresh → this Worker (runtime)
 *   - Data validation / ID mapping    → scripts/ (build time, run by maintainer)
 *   - Bandai manual search            → plain outbound link (no server needed)
 *
 * Deploy:  cd serverless && npx wrangler deploy
 * Local:   npx wrangler dev   →  http://127.0.0.1:8787/api/news
 */

const FEEDS = [
    { name: 'Bandai Hobby', url: 'https://bandai-hobby.net/feed/', icon: '🆕' },
    { name: 'GUNDAM.INFO', url: 'https://en.gundam.info/rss', icon: '📡' }
];

const FETCH_TIMEOUT_MS = 8000;
const FETCH_ATTEMPTS = 2;              // per-feed retry
const EDGE_CACHE_SECONDS = 900;        // CDN cache = server-side refresh policy (15 min)
const BROWSER_CACHE_SECONDS = 300;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        if (request.method !== 'GET') {
            return json({ ok: false, error: 'method_not_allowed' }, 405);
        }

        const url = new URL(request.url);
        if (url.pathname === '/api/health') {
            return json({ ok: true, now: Date.now() });
        }
        if (url.pathname === '/api/news') {
            return handleNews(request, ctx);
        }
        return json({ ok: false, error: 'not_found' }, 404);
    }
};

function json(body, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            ...CORS_HEADERS,
            ...extraHeaders
        }
    });
}

async function handleNews(request, ctx) {
    // Serve from the edge cache while fresh — this IS the cache-refresh policy:
    // at most one upstream aggregation per EDGE_CACHE_SECONDS per URL.
    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).toString(), { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const url = new URL(request.url);
    let limit = parseInt(url.searchParams.get('limit'), 10);
    if (isNaN(limit)) limit = DEFAULT_LIMIT;
    limit = Math.max(1, Math.min(MAX_LIMIT, limit));

    const results = await Promise.allSettled(FEEDS.map(fetchAndParseFeed));

    const sources = [];
    let items = [];
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
            sources.push({ name: FEEDS[i].name, ok: true, count: r.value.length });
            items = items.concat(r.value);
        } else {
            sources.push({ name: FEEDS[i].name, ok: false, count: 0 });
        }
    });

    if (items.length === 0) {
        // Nothing usable — never cache failures
        return json({ ok: false, error: 'all_feeds_failed', sources }, 502);
    }

    items.sort((a, b) => b.ts - a.ts);
    const seen = new Set();
    items = items.filter(i => (seen.has(i.link) ? false : seen.add(i.link)));
    items = items.slice(0, limit);

    const response = json(
        { ok: true, fetchedAt: Date.now(), sources, items },
        200,
        { 'Cache-Control': `public, max-age=${BROWSER_CACHE_SECONDS}, s-maxage=${EDGE_CACHE_SECONDS}` }
    );
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
}

async function fetchAndParseFeed(feed) {
    let lastError;
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
        try {
            const res = await fetchWithTimeout(feed.url, FETCH_TIMEOUT_MS);
            if (!res.ok) throw new Error(`upstream_${res.status}`);
            const text = await res.text();
            const items = parseFeed(text, feed);
            if (items.length) return items;
            throw new Error('no_items_parsed');
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError;
}

async function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'GunplaGuideBot/1.0 (news aggregator)',
                'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5'
            }
        });
    } finally {
        clearTimeout(timer);
    }
}

/* ---- XML parsing ----
   Workers have no DOMParser, so this is a tolerant tag-level extractor that
   handles RSS 2.0 <item> and Atom <entry>, CDATA, HTML entities and
   namespaced date tags. Output item shape matches the frontend exactly. */

function parseFeed(xml, feed) {
    const out = [];
    const blocks = matchBlocks(xml, 'item').concat(matchBlocks(xml, 'entry'));

    for (const block of blocks) {
        const title = cleanText(pickTag(block, ['title']));
        const link = pickLink(block);
        const dateStr = cleanText(pickTag(block, ['pubDate', 'published', 'updated', 'dc:date']));
        let ts = dateStr ? Date.parse(dateStr) : 0;
        if (isNaN(ts)) ts = 0;

        // http(s) links only — anything else is dropped server-side
        if (!title || !/^https?:\/\//i.test(link)) continue;

        out.push({
            title,
            link,
            ts,
            source: feed.name,
            icon: feed.icon,
            img: pickImage(block)
        });
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
    if (/^https?:\/\//i.test(text)) return text;

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
    const desc = stripCdata(pickTag(block, ['description', 'summary', 'content:encoded', 'content']));
    const img = /<img\b[^>]*src=["']([^"']+)["']/i.exec(desc);
    return img ? img[1] : '';
}

function stripCdata(s) {
    return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function cleanText(s) {
    return decodeEntities(stripCdata(s).replace(/<[^>]+>/g, '')).trim();
}

function decodeEntities(s) {
    return String(s || '')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}
