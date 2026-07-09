/**
 * Gunpla Guide - Notifications Module
 * Monitors Bandai Hobby / Gundam.info RSS feeds for new product & news alerts.
 *
 * Two-tier fetch strategy (backend-ish work lives in a separate serverless layer):
 *   1) Self-hosted serverless API (serverless/worker.js) when API_BASE is set —
 *      feeds are fetched, parsed, merged and edge-cached server-side.
 *   2) Zero-config fallback for pure static hosting: public CORS proxies with
 *      client-side XML parsing.
 * Results are cached in localStorage either way; if every source fails, the
 * cached items (or an empty state) are shown.
 */

const Notifications = (function () {
    const CACHE_KEY = 'gunpla-news-cache';   // { ts, items }
    const SEEN_KEY = 'gunpla-news-seen';     // timestamp (ms) of newest item the user has seen
    const TTL = 30 * 60 * 1000;              // re-fetch feeds at most every 30 min
    const MAX_ITEMS = 20;

    // RSS/Atom feeds to monitor (priority order)
    const FEEDS = [
        { name: 'Bandai Hobby', url: 'https://bandai-hobby.net/feed/', icon: '🆕' },
        { name: 'GUNDAM.INFO', url: 'https://en.gundam.info/rss', icon: '📡' }
    ];

    // Public CORS proxies, tried in order until one returns usable content
    // (fallback path only — prefer deploying the serverless API below)
    const PROXIES = [
        u => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
        u => `https://corsproxy.io/?url=${encodeURIComponent(u)}`
    ];

    // Self-hosted serverless API base URL (recommended; see serverless/README.md),
    // e.g. 'https://gunpla-guide-api.YOUR-SUBDOMAIN.workers.dev'.
    // Can also be provided without editing this file via window.GUNPLA_API_BASE.
    // Leave empty to go straight to the public CORS proxy fallback.
    const API_BASE = (typeof window !== 'undefined' && window.GUNPLA_API_BASE) || '';

    let items = [];

    // ---- helpers ----
    const lang = () => (window.I18n && I18n.getLang ? I18n.getLang() : 'ko');
    const isKo = () => lang() === 'ko';

    function nodeText(node, sel) {
        const el = node.querySelector(sel);
        return el ? el.textContent.trim() : '';
    }

    function decodeHtml(s) {
        const t = document.createElement('textarea');
        t.innerHTML = s;
        return t.value;
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function relTime(ts) {
        if (!ts) return '';
        const diff = Date.now() - ts;
        const ko = isKo();
        const min = Math.floor(diff / 60000);
        if (min < 1) return ko ? '방금' : 'just now';
        if (min < 60) return ko ? `${min}분 전` : `${min}m ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return ko ? `${hr}시간 전` : `${hr}h ago`;
        const day = Math.floor(hr / 24);
        if (day < 30) return ko ? `${day}일 전` : `${day}d ago`;
        const mon = Math.floor(day / 30);
        return ko ? `${mon}개월 전` : `${mon}mo ago`;
    }

    // ---- feed fetching / parsing ----

    /**
     * Fetch merged news from the self-hosted serverless API.
     * Returns a validated items array, or null (API unset / unreachable /
     * invalid payload) so the caller can fall back to the CORS-proxy path.
     */
    async function fetchFromApi() {
        if (!API_BASE) return null;
        try {
            const base = API_BASE.replace(/\/+$/, '');
            const res = await fetch(`${base}/api/news?limit=${MAX_ITEMS}`, { cache: 'no-store' });
            if (!res.ok) return null;
            const data = await res.json();
            if (!data || data.ok !== true || !Array.isArray(data.items)) return null;

            const valid = data.items
                .filter(i => i && i.title && typeof i.link === 'string' && /^https?:\/\//i.test(i.link))
                .map(i => ({
                    title: String(i.title),
                    link: i.link,
                    ts: Number(i.ts) || 0,
                    source: String(i.source || ''),
                    icon: i.icon || '📰',
                    img: typeof i.img === 'string' ? i.img : ''
                }));
            return valid.length ? valid : null;
        } catch (e) {
            return null;
        }
    }

    async function fetchFeed(feed) {
        for (const proxy of PROXIES) {
            try {
                const res = await fetch(proxy(feed.url), { cache: 'no-store' });
                if (!res.ok) continue;
                const text = await res.text();
                const parsed = parseFeed(text, feed);
                if (parsed.length) return parsed;
            } catch (e) {
                /* try next proxy */
            }
        }
        return [];
    }

    function parseFeed(xmlText, feed) {
        const out = [];
        try {
            const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
            if (doc.querySelector('parsererror')) return out;

            // RSS <item> or Atom <entry>
            let nodes = Array.from(doc.querySelectorAll('item'));
            if (nodes.length === 0) nodes = Array.from(doc.querySelectorAll('entry'));

            nodes.forEach(n => {
                const title = nodeText(n, 'title');

                // Link: RSS uses a text node; Atom uses <link href="...">
                let link = nodeText(n, 'link');
                if (!link) {
                    const linkEl = n.querySelector('link');
                    link = linkEl?.getAttribute('href') || '';
                }

                const dateStr = nodeText(n, 'pubDate') || nodeText(n, 'published') ||
                    nodeText(n, 'updated') || nodeText(n, 'date');
                let ts = dateStr ? Date.parse(dateStr) : 0;
                if (isNaN(ts)) ts = 0;

                // Thumbnail (best-effort)
                let img = '';
                const enclosure = n.querySelector('enclosure');
                if (enclosure?.getAttribute('url')) {
                    img = enclosure.getAttribute('url');
                } else {
                    const desc = nodeText(n, 'description') || nodeText(n, 'summary') || '';
                    const m = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
                    if (m) img = m[1];
                }

                if (title && link) {
                    out.push({
                        title: decodeHtml(title),
                        link,
                        ts,
                        source: feed.name,
                        icon: feed.icon,
                        img
                    });
                }
            });
        } catch (e) {
            /* ignore malformed feed */
        }
        return out;
    }

    // ---- cache / seen state ----
    function loadCache() {
        try {
            const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
            if (c && Array.isArray(c.items)) {
                items = c.items;
                return c;
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function saveCache() {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), items }));
        } catch (e) { /* ignore */ }
    }

    function getSeen() {
        return Number(localStorage.getItem(SEEN_KEY) || 0);
    }

    function setSeen(ts) {
        try {
            localStorage.setItem(SEEN_KEY, String(ts));
        } catch (e) { /* ignore */ }
    }

    function unreadCount() {
        const seen = getSeen();
        return items.filter(i => i.ts > seen).length;
    }

    // ---- rendering ----
    function updateBadge() {
        document.querySelectorAll('.notif-badge').forEach(badge => {
            const n = unreadCount();
            badge.textContent = n > 9 ? '9+' : (n || '');
            badge.style.display = n > 0 ? 'flex' : 'none';
        });
    }

    function renderList() {
        const list = document.getElementById('notifList');
        if (!list) return;

        if (!items.length) {
            list.innerHTML = `<div class="notif-empty">${isKo() ? '불러올 소식이 없습니다. 새로고침을 눌러보세요.' : 'No news available. Try refreshing.'}</div>`;
            return;
        }

        const seen = getSeen();
        list.innerHTML = items.slice(0, MAX_ITEMS).map(i => `
            <a class="notif-item${i.ts > seen ? ' unread' : ''}" href="${escapeHtml(i.link)}" target="_blank" rel="noopener">
                <span class="notif-item-icon">${i.icon || '📰'}</span>
                <span class="notif-item-body">
                    <span class="notif-item-title">${escapeHtml(i.title)}</span>
                    <span class="notif-item-meta">${escapeHtml(i.source)}${i.ts ? ' · ' + relTime(i.ts) : ''}</span>
                </span>
            </a>`).join('');
    }

    function setLoading(on) {
        const list = document.getElementById('notifList');
        const refreshBtn = document.getElementById('notifRefresh');
        if (refreshBtn) refreshBtn.classList.toggle('spinning', on);
        if (on && list && !items.length) {
            list.innerHTML = `<div class="notif-empty">${isKo() ? '소식을 불러오는 중…' : 'Loading news…'}</div>`;
        }
    }

    // ---- refresh ----
    async function refresh(force) {
        const cache = loadCache();
        const stale = !cache || (Date.now() - cache.ts > TTL);

        renderList();
        updateBadge();

        if (!force && !stale) return;

        setLoading(true);
        try {
            // Prefer the serverless API; fall back to public CORS proxies
            let merged = await fetchFromApi();
            if (!merged) {
                const results = await Promise.all(FEEDS.map(fetchFeed));
                merged = [].concat(...results);
            }

            if (merged.length) {
                merged.sort((a, b) => b.ts - a.ts);
                // de-duplicate by link
                const seenLinks = new Set();
                merged = merged.filter(i => (seenLinks.has(i.link) ? false : seenLinks.add(i.link)));
                items = merged.slice(0, MAX_ITEMS);
                saveCache();
            }
        } catch (e) {
            /* keep cached items */
        } finally {
            setLoading(false);
            renderList();
            updateBadge();
        }
    }

    // Mark all current items as seen (clears the badge)
    function markSeen() {
        const newest = items.reduce((m, i) => Math.max(m, i.ts || 0), getSeen());
        setSeen(newest);
        updateBadge();
    }

    // ---- init ----
    function init() {
        const toggle = document.getElementById('notifToggleBtn');
        const dropdown = toggle?.closest('.notif-dropdown');

        if (toggle && dropdown) {
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const willOpen = !dropdown.classList.contains('active');
                dropdown.classList.toggle('active');
                if (willOpen) markSeen();
            });

            // Close on outside click; keep open when interacting with the panel
            document.addEventListener('click', () => dropdown.classList.remove('active'));
            dropdown.querySelector('.notif-panel')?.addEventListener('click', e => e.stopPropagation());
        }

        const refreshBtn = document.getElementById('notifRefresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                refresh(true);
            });
        }

        // Re-render on language change (relative times / labels)
        document.addEventListener('langChange', renderList);

        loadCache();
        renderList();
        updateBadge();
        refresh(false); // fetch fresh in the background if cache is stale
    }

    return { init, refresh };
})();

window.Notifications = Notifications;

// Self-initialize once the DOM is ready (works on all pages)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Notifications.init);
} else {
    Notifications.init();
}
