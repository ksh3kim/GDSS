/**
 * Outbound HTTP helpers shared by the Worker and the Node build scripts.
 * Only standard fetch/AbortController are used, so this runs unchanged on
 * Cloudflare Workers and Node (the project requires Node 22+, see package.json "engines").
 */

// Identifies the bot honestly; the "Mozilla/5.0 (compatible; …)" form is the
// common crawler convention — bandai-hobby.net answers a bare bot UA with a 404 page.
export const USER_AGENT = 'Mozilla/5.0 (compatible; GunplaGuideBot/1.0; +https://github.com/ksh3kim/GDSS)';

/**
 * fetch() with a hard timeout. `fetchImpl` defaults to the global fetch at
 * call time, so tests can swap globalThis.fetch.
 */
export async function fetchWithTimeout(url, { timeoutMs = 8000, headers = {}, fetchImpl } = {}) {
    const doFetch = fetchImpl || globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await doFetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': USER_AGENT, ...headers }
        });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * GET a URL as text, retrying on network errors and non-2xx responses.
 * Throws the last error when every attempt fails.
 */
export async function fetchText(url, { attempts = 2, ...options } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const res = await fetchWithTimeout(url, options);
            if (!res.ok) throw new Error(`upstream_${res.status}`);
            return await res.text();
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError;
}

/**
 * Decode the HTML/XML entities that appear in feed titles and page text
 */
export function decodeEntities(s) {
    return String(s || '')
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

/**
 * Entity-decoded, tag-stripped, whitespace-collapsed text. Decoding comes
 * first so escaped markup (Atom type="html" titles: &lt;b&gt;) is removed too.
 */
export function cleanText(s) {
    const unwrapped = String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    return decodeEntities(unwrapped)
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
