/**
 * Gunpla Guide — Serverless API (Cloudflare Worker)
 *
 * Runtime backend layer separated out of the static web app:
 *
 *   GET /api/news?limit=20         Aggregated Bandai Hobby / GUNDAM OFFICIAL news
 *                                  (server-side fetch + parse + merge + cache)
 *   GET /api/manual?grade=&model=&name=&year=
 *                                  Finds the kit's page on the official Bandai
 *                                  manual site (server-side search + ranking)
 *   GET /api/health                Liveness + news cache status
 *
 * Cache refresh:
 *   - Cron Trigger (wrangler.toml [triggers]) re-aggregates the news on a
 *     schedule and stores a snapshot in Workers KV (binding NEWS_CACHE).
 *     /api/news then answers from that snapshot without touching upstream.
 *   - Without the KV binding the cron run is a no-op and /api/news falls back
 *     to on-demand aggregation behind the edge cache (s-maxage).
 *
 * Layer boundaries (for maintainers):
 *   - News collection, scheduled cache refresh, manual lookup → this Worker
 *   - Data validation, manual-id backfill                     → scripts/ (build time)
 *
 * Deploy:  cd serverless && npx wrangler deploy
 * Local:   npx wrangler dev   →  http://127.0.0.1:8787/api/news
 * Tests:   cd serverless && node --test test/
 */

import { aggregateNews } from './lib/news.js';
import { searchManual, buildSearchUrl, categoriesFor, queryCandidates } from './lib/manual.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// News cache policy
const NEWS_KV_KEY = 'news:v1';
const NEWS_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000; // older than this → refresh on demand
const NEWS_EDGE_SECONDS = 900;                    // 15 min (edge cache, no-KV path)
const NEWS_BROWSER_SECONDS = 300;

// Manual lookup cache policy (kit pages essentially never move)
const MANUAL_EDGE_SECONDS = 7 * 24 * 60 * 60;
const MANUAL_BROWSER_SECONDS = 24 * 60 * 60;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
};

export default {
    async fetch(request, env = {}, ctx = { waitUntil() {} }) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }
        if (request.method !== 'GET') {
            return json({ ok: false, error: 'method_not_allowed' }, 405);
        }

        const url = new URL(request.url);
        try {
            if (url.pathname === '/api/health') return await handleHealth(env);
            if (url.pathname === '/api/news') return await handleNews(request, env, ctx);
            if (url.pathname === '/api/manual') return await handleManual(request, ctx);
        } catch (e) {
            console.error('unhandled', url.pathname, e);
            return json({ ok: false, error: 'internal_error' }, 500);
        }
        return json({ ok: false, error: 'not_found' }, 404);
    },

    // Cron Trigger: refresh the news snapshot ahead of requests
    async scheduled(event, env = {}, ctx = { waitUntil() {} }) {
        if (!env.NEWS_CACHE) {
            console.log('scheduled: NEWS_CACHE KV binding not configured — skipping refresh');
            return;
        }
        const snapshot = await refreshNewsSnapshot(env);
        console.log('scheduled: news refreshed', snapshot ? snapshot.items.length : 0, 'items');
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

function edgeCache() {
    // caches.default exists on Workers; absent in Node tests / other runtimes
    return typeof caches !== 'undefined' && caches.default ? caches.default : null;
}

// ---- /api/health ----

async function handleHealth(env) {
    const body = { ok: true, now: Date.now(), newsCache: env.NEWS_CACHE ? 'kv' : 'edge' };
    if (env.NEWS_CACHE) {
        const snapshot = await readSnapshot(env);
        body.newsSnapshot = snapshot
            ? { fetchedAt: snapshot.fetchedAt, items: snapshot.items.length, sources: snapshot.sources }
            : null;
    }
    return json(body, 200, { 'Cache-Control': 'no-store' });
}

// ---- /api/news ----

function parseLimit(url) {
    let limit = parseInt(url.searchParams.get('limit'), 10);
    if (isNaN(limit)) limit = DEFAULT_LIMIT;
    return Math.max(1, Math.min(MAX_LIMIT, limit));
}

async function readSnapshot(env) {
    try {
        const raw = await env.NEWS_CACHE.get(NEWS_KV_KEY);
        const snapshot = raw ? JSON.parse(raw) : null;
        return snapshot && Array.isArray(snapshot.items) ? snapshot : null;
    } catch (e) {
        console.error('readSnapshot', e);
        return null;
    }
}

/**
 * Aggregate upstream feeds and, when anything came back, store the result
 * in KV. Returns the snapshot, or null when every feed failed (the previous
 * snapshot is kept in that case).
 */
async function refreshNewsSnapshot(env) {
    const snapshot = await aggregateNews({ limit: MAX_LIMIT });
    if (!snapshot.items.length) return null;
    if (env.NEWS_CACHE) {
        await env.NEWS_CACHE.put(NEWS_KV_KEY, JSON.stringify(snapshot));
    }
    return snapshot;
}

function newsResponse(snapshot, limit, cacheSource) {
    return json(
        {
            ok: true,
            fetchedAt: snapshot.fetchedAt,
            cache: cacheSource,
            sources: snapshot.sources,
            items: snapshot.items.slice(0, limit)
        },
        200,
        { 'Cache-Control': `public, max-age=${NEWS_BROWSER_SECONDS}, s-maxage=${NEWS_EDGE_SECONDS}` }
    );
}

async function handleNews(request, env, ctx) {
    const url = new URL(request.url);
    const limit = parseLimit(url);

    // 1) KV snapshot kept fresh by the cron trigger
    if (env.NEWS_CACHE) {
        const snapshot = await readSnapshot(env);
        if (snapshot && Date.now() - snapshot.fetchedAt < NEWS_SNAPSHOT_MAX_AGE_MS) {
            return newsResponse(snapshot, limit, 'kv');
        }
        // Missing/stale (cron not running yet) → refresh now
        const fresh = await refreshNewsSnapshot(env);
        if (fresh) return newsResponse(fresh, limit, 'live');
        if (snapshot) return newsResponse(snapshot, limit, 'kv-stale'); // upstream down: serve old data
        return json({ ok: false, error: 'all_feeds_failed' }, 502);
    }

    // 2) No KV: on-demand aggregation behind the edge cache — at most one
    //    upstream aggregation per NEWS_EDGE_SECONDS per URL
    const cache = edgeCache();
    const cacheKey = new Request(url.toString(), { method: 'GET' });
    if (cache) {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
    }

    const snapshot = await aggregateNews({ limit });
    if (!snapshot.items.length) {
        // Nothing usable — never cache failures
        return json({ ok: false, error: 'all_feeds_failed', sources: snapshot.sources }, 502);
    }
    const response = newsResponse(snapshot, limit, 'live');
    if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
}

// ---- /api/manual ----

function cleanParam(url, name, max) {
    return String(url.searchParams.get(name) || '').trim().slice(0, max);
}

async function handleManual(request, ctx) {
    const url = new URL(request.url);
    const product = {
        grade: cleanParam(url, 'grade', 12).toUpperCase(),
        modelNumber: cleanParam(url, 'model', 40),
        nameEn: cleanParam(url, 'name', 120),
        releaseYear: parseInt(url.searchParams.get('year'), 10) || null
    };
    if (!product.nameEn && !product.modelNumber) {
        return json({ ok: false, error: 'missing_query', hint: 'pass name and/or model' }, 400);
    }

    // Normalized cache key: the same kit always maps to the same entry
    const keyUrl = new URL('/api/manual', url.origin);
    keyUrl.searchParams.set('grade', product.grade);
    keyUrl.searchParams.set('model', product.modelNumber.toUpperCase());
    keyUrl.searchParams.set('name', product.nameEn.toUpperCase());
    if (product.releaseYear) keyUrl.searchParams.set('year', String(product.releaseYear));
    const cacheKey = new Request(keyUrl.toString(), { method: 'GET' });

    const cache = edgeCache();
    if (cache) {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
    }

    const fallbackSearchUrl = buildSearchUrl({
        freeword: queryCandidates(product)[0] || product.nameEn,
        categories: categoriesFor(product.grade)
    });

    let result;
    try {
        result = await searchManual(product);
    } catch (e) {
        // Site unreachable — tell the client where to send the user instead
        return json({ ok: false, error: 'upstream_failed', searchUrl: fallbackSearchUrl }, 502);
    }

    const pick = r => r && {
        id: r.id,
        url: r.url,
        nameEn: r.nameEn,
        nameJa: r.nameJa,
        releaseYear: r.releaseYear,
        score: r.score
    };
    const response = json(
        {
            ok: true,
            match: pick(result.match),
            candidates: result.candidates.map(pick),
            searchUrl: result.searchUrl || fallbackSearchUrl
        },
        200,
        { 'Cache-Control': `public, max-age=${MANUAL_BROWSER_SECONDS}, s-maxage=${MANUAL_EDGE_SECONDS}` }
    );
    if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
}
