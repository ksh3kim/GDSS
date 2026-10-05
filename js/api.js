/**
 * Gunpla Guide - API Client
 * The one place the static app talks to the optional serverless backend
 * (serverless/worker.js). Every caller must keep working when the API is not
 * configured or not reachable — methods resolve to null instead of throwing.
 *
 *   getNews(limit)       → GET /api/news     (used by js/notifications.js)
 *   findManual(product)  → GET /api/manual   (used by the detail page)
 *   manualSearchUrl()    → official manual search link that works without the API
 */

const GunplaApi = (function () {
    // Deployed Worker URL, e.g. 'https://gunpla-guide-api.YOUR-SUBDOMAIN.workers.dev'
    // (see serverless/README.md). Can also be set without editing this file:
    //   <script>window.GUNPLA_API_BASE = 'https://…';</script>  before the app scripts.
    const API_BASE = (typeof window !== 'undefined' && window.GUNPLA_API_BASE) || '';
    const BASE = String(API_BASE).replace(/\/+$/, '');
    const TIMEOUT_MS = 8000;

    const MANUAL_ORIGIN = 'https://manual.bandai-hobby.net';
    const MANUAL_CACHE_KEY = 'gunpla-manual-cache';    // { [productId]: { url: string|null, ts } }
    const MANUAL_HIT_TTL = 30 * 24 * 60 * 60 * 1000;   // a found manual page doesn't move
    const MANUAL_MISS_TTL = 24 * 60 * 60 * 1000;       // retry "not found" daily

    // Site search categories by grade — mirrors GRADE_CATEGORIES in
    // serverless/lib/manual.js (kept here so the fallback link needs no API)
    const HG_FAMILY = [1, 5];
    const GRADE_CATEGORIES = {
        HG: HG_FAMILY, HGCE: HG_FAMILY, HGAC: HG_FAMILY, HGAW: HG_FAMILY, HGFC: HG_FAMILY, HGCC: HG_FAMILY,
        HGBD: HG_FAMILY, HGBF: HG_FAMILY, HGIBO: HG_FAMILY, HGTWFM: HG_FAMILY,
        HGUC: [5, 1], EG: [2], FM: [4], MG: [6], MGEX: [7], PG: [9], PGU: [9], RG: [10],
        SDEX: [14], SDCS: [35], RE100: [133]
    };
    const GENERIC_WORDS = ['GUNDAM', 'MODE', 'II', 'III', 'EW', 'THE', 'OF', 'AND', 'FOR'];

    const pendingManual = new Map(); // productId -> Promise (dedupe concurrent lookups)

    function isConfigured() {
        return Boolean(BASE);
    }

    /**
     * GET BASE+path with a timeout. Resolves to { ok, status, data } or null
     * (API not configured, network error, timeout, non-JSON body).
     */
    async function request(path, params = {}, { cache = 'default' } = {}) {
        if (!BASE) return null;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
            const url = new URL(BASE + path);
            Object.entries(params).forEach(([k, v]) => {
                if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
            });
            const res = await fetch(url.toString(), { signal: controller.signal, cache });
            const data = await res.json();
            return { ok: res.ok, status: res.status, data };
        } catch (e) {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Raw news items from the API, or null (callers validate each item)
     */
    async function getNews(limit = 20) {
        const res = await request('/api/news', { limit }, { cache: 'no-store' });
        if (!res || !res.ok || !res.data || res.data.ok !== true || !Array.isArray(res.data.items)) return null;
        return res.data.items;
    }

    function manualDetailUrl(id) {
        return `${MANUAL_ORIGIN}/menus/detail/${encodeURIComponent(id)}`;
    }

    /**
     * Search link on the official manual site. The site matches `freeword` as
     * one substring of the kit name, so this uses a single term: the model
     * number when it is a plain code (RX-78-2), else the most distinctive
     * word of the English name — the same first query the API tries.
     */
    function manualSearchUrl(product) {
        const model = String(product.modelNumber || '').trim().toUpperCase();
        let term = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(model) ? model : '';
        if (!term) {
            const words = String(product.name?.en || '').toUpperCase().split(/\s+/)
                .map(w => w.replace(/[^A-Z0-9.'-]/g, ''))
                .map(w => (w === 'NU' ? 'ν' : w))
                .filter(w => !GENERIC_WORDS.includes(w) && !/^VER\./.test(w) && (w.length >= 3 || w === 'ν'))
                .sort((a, b) => b.length - a.length);
            term = words[0] || String(product.name?.en || '');
        }
        const params = new URLSearchParams();
        if (term) params.set('freeword', term);
        (GRADE_CATEGORIES[String(product.grade || '').toUpperCase()] || [])
            .forEach(c => params.append('categories[]', String(c)));
        return `${MANUAL_ORIGIN}/menus?${params.toString()}`;
    }

    function readManualCache() {
        try {
            const cache = JSON.parse(localStorage.getItem(MANUAL_CACHE_KEY) || '{}');
            return cache && typeof cache === 'object' ? cache : {};
        } catch (e) {
            return {};
        }
    }

    function writeManualCache(productId, url) {
        try {
            const cache = readManualCache();
            cache[productId] = { url, ts: Date.now() };
            localStorage.setItem(MANUAL_CACHE_KEY, JSON.stringify(cache));
        } catch (e) { /* storage full / blocked — just skip caching */ }
    }

    /**
     * The kit's own manual page URL via /api/manual, or null (no API, no
     * confident match, or the API/site is unreachable). Results — including
     * "no match" — are cached per product in localStorage.
     */
    function findManual(product) {
        if (!BASE || !product?.id) return Promise.resolve(null);

        const cached = readManualCache()[product.id];
        if (cached) {
            const ttl = cached.url ? MANUAL_HIT_TTL : MANUAL_MISS_TTL;
            if (Date.now() - cached.ts < ttl) return Promise.resolve(cached.url);
        }
        if (pendingManual.has(product.id)) return pendingManual.get(product.id);

        const lookup = request('/api/manual', {
            grade: product.grade,
            model: product.modelNumber,
            name: product.name?.en,
            year: product.releaseYear
        }).then(res => {
            if (!res || !res.ok || !res.data || res.data.ok !== true) return null; // transient: don't cache
            const url = res.data.match?.url;
            // Only ever send users to the official manual site
            const safe = typeof url === 'string' && url.startsWith(`${MANUAL_ORIGIN}/menus/detail/`) ? url : null;
            writeManualCache(product.id, safe);
            return safe;
        }).finally(() => pendingManual.delete(product.id));

        pendingManual.set(product.id, lookup);
        return lookup;
    }

    return { isConfigured, request, getNews, findManual, manualSearchUrl, manualDetailUrl };
})();

window.GunplaApi = GunplaApi;
