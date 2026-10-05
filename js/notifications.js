/**
 * Gunpla Guide - Notifications Module
 * Shows Bandai Hobby / GUNDAM OFFICIAL news (new kits, pre-orders, topics)
 * in the header bell panel.
 *
 * Collecting the news is backend work and lives entirely in the serverless
 * layer (serverless/worker.js → GET /api/news, configured in js/api.js): the
 * official sites publish no RSS any more and can't be read from the browser
 * (CORS), so the Worker reads their news pages, merges them and keeps them
 * cached (refreshed on a schedule when its KV cache is bound).
 *
 * This module only asks the API — on page load when the local copy is older
 * than TTL, and on manual refresh. There is NO continuous polling and NO push.
 * Without a configured API no request is made and the panel says so, linking
 * to the official news pages. Results are cached in localStorage; if the API
 * fails, the cached items (or an explanatory empty state) are shown.
 */

const Notifications = (function () {
    const CACHE_KEY = 'gunpla-news-cache';   // { ts, items }
    const SEEN_KEY = 'gunpla-news-seen';     // timestamp (ms) of newest item the user has seen
    const TTL = 30 * 60 * 1000;              // ask the API at most every 30 min
    const MAX_ITEMS = 20;
    const KINDS = ['product', 'shop', 'news'];

    const HAS_API = Boolean(window.GunplaApi && GunplaApi.isConfigured());

    let items = [];
    let status = 'idle'; // 'idle' | 'loading' | 'failed' | 'unconfigured'

    // ---- helpers ----
    const lang = () => (window.I18n && I18n.getLang ? I18n.getLang() : 'ko');
    const isKo = () => lang() === 'ko';

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // Only http(s) links may become hrefs — API and cached data are still
    // treated as untrusted
    const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

    function sanitizeItem(i) {
        if (!i || !i.title || !isHttpUrl(i.link)) return null;
        return {
            title: String(i.title),
            link: i.link,
            ts: Number(i.ts) || 0,
            source: String(i.source || ''),
            icon: typeof i.icon === 'string' ? i.icon : '📰',
            img: isHttpUrl(i.img) ? i.img : '',
            kind: KINDS.includes(i.kind) ? i.kind : 'news'
        };
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

    /**
     * News from the serverless API, validated; null when unavailable
     */
    async function fetchFromApi() {
        if (!HAS_API) return null;
        const raw = await GunplaApi.getNews(MAX_ITEMS);
        if (!raw) return null;
        const valid = raw.map(sanitizeItem).filter(Boolean);
        return valid.length ? valid : null;
    }

    // ---- cache / seen state ----
    function loadCache() {
        try {
            const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
            if (c && Array.isArray(c.items)) {
                items = c.items.map(sanitizeItem).filter(Boolean);
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
        try {
            return Number(localStorage.getItem(SEEN_KEY) || 0) || 0;
        } catch (e) {
            return 0;
        }
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

    function emptyMessage() {
        if (status === 'loading') return I18n.t('notif.loading');
        if (status === 'unconfigured') return I18n.t('notif.notConfigured');
        if (status === 'failed') return I18n.t('notif.fetchFailed');
        return I18n.t('notif.empty');
    }

    function kindLabel(kind) {
        if (kind === 'product') return I18n.t('notif.kindProduct');
        if (kind === 'shop') return I18n.t('notif.kindShop');
        return '';
    }

    function renderList() {
        const list = document.getElementById('notifList');
        if (!list) return;

        // Without the API, refreshing can't do anything — don't offer it
        const refreshBtn = document.getElementById('notifRefresh');
        if (refreshBtn) refreshBtn.hidden = !HAS_API;

        if (!items.length) {
            list.innerHTML = `<div class="notif-empty">${escapeHtml(emptyMessage())}</div>`;
            return;
        }

        const seen = getSeen();
        list.innerHTML = items.slice(0, MAX_ITEMS).map(i => {
            const label = kindLabel(i.kind);
            return `
            <a class="notif-item${i.ts > seen ? ' unread' : ''}" href="${escapeHtml(i.link)}" target="_blank" rel="noopener">
                <span class="notif-item-icon" aria-hidden="true">${escapeHtml(i.icon || '📰')}</span>
                <span class="notif-item-body">
                    <span class="notif-item-title">${escapeHtml(i.title)}</span>
                    <span class="notif-item-meta">${label ? `<span class="notif-item-kind -${i.kind}">${escapeHtml(label)}</span>` : ''}${escapeHtml(i.source)}${i.ts ? ' · ' + relTime(i.ts) : ''}</span>
                </span>
            </a>`;
        }).join('');
    }

    function setLoading(on) {
        const refreshBtn = document.getElementById('notifRefresh');
        if (refreshBtn) refreshBtn.classList.toggle('spinning', on);
        if (on) {
            status = 'loading';
            if (!items.length) renderList();
        }
    }

    // ---- refresh ----
    async function refresh(force) {
        const cache = loadCache();
        const stale = !cache || (Date.now() - cache.ts > TTL);

        if (!HAS_API) {
            status = 'unconfigured';
            renderList();
            updateBadge();
            return;
        }

        renderList();
        updateBadge();

        if (!force && !stale) return;

        setLoading(true);
        let fetched = false;
        try {
            const fresh = await fetchFromApi();
            if (fresh) {
                // The API already sorts and de-duplicates; keep the client defensive anyway
                fresh.sort((a, b) => b.ts - a.ts);
                const seenLinks = new Set();
                items = fresh.filter(i => (seenLinks.has(i.link) ? false : seenLinks.add(i.link))).slice(0, MAX_ITEMS);
                saveCache();
                fetched = true;
            }
        } catch (e) {
            /* keep cached items */
        } finally {
            setLoading(false);
            status = fetched ? 'idle' : 'failed';
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
            const setOpen = (open) => {
                dropdown.classList.toggle('active', open);
                toggle.setAttribute('aria-expanded', String(open));
            };

            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const willOpen = !dropdown.classList.contains('active');
                setOpen(willOpen);
                if (willOpen) {
                    // Re-render: language and relative times may have changed
                    // since the list was built
                    renderList();
                    markSeen();
                    // Only one header popup at a time (the theme menu closes itself)
                    document.dispatchEvent(new CustomEvent('dropdownOpen', { detail: { id: 'notif' } }));
                }
            });

            document.addEventListener('dropdownOpen', (e) => {
                if (e.detail?.id !== 'notif') setOpen(false);
            });

            // Close on outside click / Escape; keep open when interacting with the panel
            document.addEventListener('click', () => setOpen(false));
            dropdown.querySelector('.notif-panel')?.addEventListener('click', e => e.stopPropagation());
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && dropdown.classList.contains('active')) {
                    setOpen(false);
                    toggle.focus();
                }
            });
        }

        const refreshBtn = document.getElementById('notifRefresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                refresh(true);
            });
        }

        // Re-render once translations load, and on language change (relative times / labels)
        document.addEventListener('i18nReady', renderList);
        document.addEventListener('langChange', renderList);

        // Another tab fetched news or marked it as seen — mirror it here
        window.addEventListener('storage', (e) => {
            if (e.key === CACHE_KEY || e.key === SEEN_KEY || e.key === null) {
                loadCache();
                renderList();
                updateBadge();
            }
        });

        loadCache();
        renderList();
        updateBadge();
        refresh(false); // ask the API in the background if the local copy is stale
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
