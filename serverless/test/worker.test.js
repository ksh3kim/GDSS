import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { fixture, stubFetch, memoryKV, installEdgeCache, execContext } from './helpers.js';

const BASE = 'https://api.example.workers.dev';
const get = (path, env, ctx) => worker.fetch(new Request(BASE + path), env, ctx);

const feedsOnline = url => {
    if (url.startsWith('https://bandai-hobby.net/news/')) return fixture('bandai-news.html');
    if (url.startsWith('https://en.gundam-official.com/news')) return fixture('gundam-news.html');
    if (url.startsWith('https://manual.bandai-hobby.net/')) return fixture('manual-search.html');
    return new Response('not found', { status: 404 });
};
const offline = () => { throw new Error('offline'); };

test('routing: CORS preflight, 405, 404, health', async () => {
    const pre = await worker.fetch(new Request(BASE + '/api/news', { method: 'OPTIONS' }));
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');

    assert.equal((await worker.fetch(new Request(BASE + '/api/news', { method: 'POST' }))).status, 405);
    assert.equal((await get('/nope')).status, 404);

    const health = await (await get('/api/health', {})).json();
    assert.equal(health.ok, true);
    assert.equal(health.newsCache, 'edge');
});

test('/api/news without KV: live aggregation, then served from the edge cache', async () => {
    const edge = installEdgeCache();
    const stub = stubFetch(feedsOnline);
    try {
        const ctx = execContext();
        const res = await get('/api/news?limit=3', {}, ctx);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.cache, 'live');
        assert.equal(body.items.length, 3);
        assert.match(res.headers.get('Cache-Control'), /s-maxage=900/);
        await ctx.done();

        const before = stub.calls.length;
        const again = await get('/api/news?limit=3', {}, execContext());
        assert.equal(again.status, 200);
        assert.equal(stub.calls.length, before, 'second request must not hit upstream');
    } finally {
        stub.restore();
        edge.uninstall();
    }
});

test('/api/news: all feeds down → 502, and the failure is not cached', async () => {
    const edge = installEdgeCache();
    const stub = stubFetch(offline);
    try {
        const res = await get('/api/news', {}, execContext());
        assert.equal(res.status, 502);
        assert.equal((await res.json()).error, 'all_feeds_failed');
        assert.equal(edge.store.size, 0);
    } finally {
        stub.restore();
        edge.uninstall();
    }
});

test('scheduled refresh writes the KV snapshot; /api/news then serves it without upstream calls', async () => {
    const kv = memoryKV();
    const env = { NEWS_CACHE: kv };
    const stub = stubFetch(feedsOnline);
    try {
        await worker.scheduled({ cron: '*/15 * * * *' }, env, execContext());
        const snapshot = JSON.parse(kv.store.get('news:v1'));
        assert.ok(snapshot.items.length > 0);

        const calls = stub.calls.length;
        const body = await (await get('/api/news?limit=2', env, execContext())).json();
        assert.equal(body.cache, 'kv');
        assert.equal(body.items.length, 2);
        assert.equal(stub.calls.length, calls);

        const health = await (await get('/api/health', env)).json();
        assert.equal(health.newsCache, 'kv');
        assert.equal(health.newsSnapshot.items, snapshot.items.length);
    } finally {
        stub.restore();
    }
});

test('stale KV snapshot is refreshed; if upstream is down the stale copy is served', async () => {
    const old = { fetchedAt: Date.now() - 3 * 60 * 60 * 1000, sources: [], items: [{ title: 'old', link: 'https://x.example/', ts: 1, source: 'X', icon: '📰', img: '' }] };
    const env = { NEWS_CACHE: memoryKV({ 'news:v1': JSON.stringify(old) }) };

    let stub = stubFetch(offline);
    try {
        const body = await (await get('/api/news', env, execContext())).json();
        assert.equal(body.cache, 'kv-stale');
        assert.equal(body.items[0].title, 'old');
    } finally {
        stub.restore();
    }

    stub = stubFetch(feedsOnline);
    try {
        const body = await (await get('/api/news', env, execContext())).json();
        assert.equal(body.cache, 'live');
        assert.notEqual(body.items[0].title, 'old');
        assert.ok(JSON.parse(env.NEWS_CACHE.store.get('news:v1')).fetchedAt > old.fetchedAt);
    } finally {
        stub.restore();
    }
});

test('scheduled run without KV is a no-op (no upstream traffic)', async () => {
    const stub = stubFetch(feedsOnline);
    try {
        await worker.scheduled({}, {}, execContext());
        assert.equal(stub.calls.length, 0);
    } finally {
        stub.restore();
    }
});

test('/api/manual validates input, returns the match, caches it', async () => {
    assert.equal((await get('/api/manual?grade=RG')).status, 400);

    const edge = installEdgeCache();
    const stub = stubFetch(feedsOnline);
    try {
        const ctx = execContext();
        const res = await get('/api/manual?grade=RG&model=RX-78-2&name=RX-78-2%20Gundam&year=2010', {}, ctx);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.match.id, '656');
        assert.equal(body.match.url, 'https://manual.bandai-hobby.net/menus/detail/656');
        assert.ok(body.candidates.length >= 2);
        assert.match(body.searchUrl, /freeword=/);
        await ctx.done();

        const calls = stub.calls.length;
        // Same kit, different casing → same cache entry
        await get('/api/manual?grade=rg&model=rx-78-2&name=RX-78-2%20GUNDAM&year=2010', {}, execContext());
        assert.equal(stub.calls.length, calls);
    } finally {
        stub.restore();
        edge.uninstall();
    }
});

test('/api/manual: site unreachable → 502 with a usable search URL, not cached', async () => {
    const edge = installEdgeCache();
    const stub = stubFetch(offline);
    try {
        const res = await get('/api/manual?grade=MG&model=MSN-04&name=Sazabi%20Ver.Ka', {}, execContext());
        assert.equal(res.status, 502);
        const body = await res.json();
        assert.equal(body.error, 'upstream_failed');
        assert.match(body.searchUrl, /^https:\/\/manual\.bandai-hobby\.net\/menus\?freeword=MSN-04/);
        assert.equal(edge.store.size, 0);
    } finally {
        stub.restore();
        edge.uninstall();
    }
});
