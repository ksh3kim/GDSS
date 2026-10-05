/**
 * Offline test doubles: fetch, Workers KV and the Workers edge cache.
 */
import { readFileSync } from 'node:fs';

export const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/**
 * Replace globalThis.fetch with a router: handler(url) returns a Response,
 * a string (200 text body), or throws. Returns { calls, restore }.
 */
export function stubFetch(handler) {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (input) => {
        const url = typeof input === 'string' ? input : input.url;
        calls.push(url);
        const out = await handler(url);
        return typeof out === 'string' ? new Response(out, { status: 200 }) : out;
    };
    return { calls, restore: () => { globalThis.fetch = original; } };
}

export function memoryKV(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        store,
        async get(key) { return store.has(key) ? store.get(key) : null; },
        async put(key, value) { store.set(key, value); }
    };
}

export function installEdgeCache() {
    const store = new Map();
    globalThis.caches = {
        default: {
            async match(req) { const r = store.get(req.url); return r ? r.clone() : undefined; },
            async put(req, res) { store.set(req.url, res); }
        }
    };
    return { store, uninstall: () => { delete globalThis.caches; } };
}

/** ctx double that lets tests await waitUntil() work */
export function execContext() {
    const pending = [];
    return { pending, waitUntil(p) { pending.push(p); }, done: () => Promise.all(pending) };
}
