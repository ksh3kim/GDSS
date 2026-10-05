/**
 * Gunpla Guide - Main Application
 * Data loading, rendering, and UI interactions
 */

const GunplaApp = (function () {
    // State
    let products = [];
    let filteredProducts = [];
    let displayedCount = 0;
    let currentView = 'grid';
    let currentSort = 'releaseDate';
    let sortOrder = 'desc'; // 'desc' = descending (newest first), 'asc' = ascending
    let currentProduct = null; // For detail page language switching
    let currentPage = 'home';  // 'home' | 'favorites' | 'compare' (main page view)
    const ITEMS_PER_PAGE = 24;
    const VIEWS = ['home', 'favorites', 'compare'];

    // Favorites and Compare
    let favorites = [];
    let compareList = [];
    const MAX_COMPARE = 4;
    let detailActionsWired = false; // guard so detail buttons are wired only once
    let compareDrawerDismissed = false; // user closed the drawer; reopens on the next compare change

    // Recently Viewed
    const RECENT_KEY = 'gunpla-recent-viewed';
    const MAX_RECENT = 10;

    // Detail page image gallery
    let galleryImages = [];
    let galleryIndex = 0;
    let galleryWired = false;    // guard so prev/next are wired only once
    let detailTabsWired = false; // guard so tab buttons are wired only once

    /**
     * Escape text before interpolating it into innerHTML templates
     */
    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * Initialize the application
     */
    async function init() {
        try {
            // Show loading
            showLoading(true);

            // Initialize modules
            await I18n.init();
            I18n.initTheme(); // Apply saved theme
            await Filter.init();

            // Load product data
            const loaded = await loadProducts();

            // Setup event listeners
            setupEventListeners();

            // Load saved data
            loadSavedData();

            // Initial render — the view comes from the URL so reload, deep
            // links (detail page → index.html?view=favorites) and back/forward
            // all land on the same screen
            renderView(getViewFromURL());
            renderRecentProducts();

            // Data failed to load: say so instead of "no search results"
            if (!loaded) setEmptyState('common.error', null);

            showLoading(false);

        } catch (error) {
            console.error('App initialization failed:', error);
            showLoading(false);
        }
    }

    /**
     * Load products from JSON. Resolves to false when the index could not be loaded.
     */
    async function loadProducts() {
        try {
            const response = await fetch('data/gunpla-index.json');
            if (!response.ok) throw new Error(`Failed to load index (${response.status})`);
            const data = await response.json();
            products = data.products || [];
            return true;
        } catch (error) {
            console.error('Failed to load products:', error);
            products = [];
            return false;
        }
    }

    /**
     * Normalize a gunpla.fyi boxart URL: add the missing .jpeg extension.
     * Non-gunpla.fyi URLs are returned unchanged; falsy input returns ''.
     */
    function normalizeImageUrl(url) {
        if (!url) return '';
        if (url.includes('gunpla.fyi/images/boxarts/')
            && !url.endsWith('.jpeg') && !url.endsWith('.jpg') && !url.endsWith('.png')) {
            return url + '.jpeg';
        }
        return url;
    }

    /**
     * gunpla.fyi boxarts are addressed by a numeric id. Several detail files
     * still carry a product slug there (…/boxarts/rg-rx-78-2), which 404s —
     * treat those as missing so the page falls back to the index thumbnail.
     */
    function isUsableImageUrl(url) {
        const m = /gunpla\.fyi\/images\/boxarts\/([^/?#.]+)/.exec(url || '');
        return !m || /^\d+$/.test(m[1]);
    }

    /**
     * Get properly formatted thumbnail URL from gunpla.fyi
     * Supports both old format (without .jpeg) and new format (with .jpeg)
     * Also supports gunplaFyiId field for direct ID mapping
     */
    function getThumbnailUrl(product) {
        // If gunplaFyiId is provided, use it directly
        if (product.gunplaFyiId) {
            return `https://gunpla.fyi/images/boxarts/${product.gunplaFyiId}.jpeg`;
        }

        // If thumbnail URL is provided
        if (product.thumbnail && isUsableImageUrl(product.thumbnail)) {
            return normalizeImageUrl(product.thumbnail);
        }

        return 'images/placeholder.png';
    }

    /**
     * Get recently viewed products from localStorage
     */
    function getRecentProducts() {
        try {
            const data = JSON.parse(localStorage.getItem(RECENT_KEY));
            return Array.isArray(data) ? data : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * Add product to recently viewed
     */
    function addToRecent(productId) {
        let recent = getRecentProducts();

        // Remove if exists (to move to front)
        recent = recent.filter(id => id !== productId);

        // Add to beginning
        recent.unshift(productId);

        // Limit to max
        recent = recent.slice(0, MAX_RECENT);

        try {
            localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
        } catch (e) {
            console.warn('Failed to save recent products:', e);
        }

        renderRecentProducts();
    }

    /**
     * Clear all recent products
     */
    function clearRecentProducts() {
        try {
            localStorage.removeItem(RECENT_KEY);
        } catch (e) {
            console.warn('Failed to clear recent products:', e);
        }
        renderRecentProducts();
    }

    /**
     * Render recently viewed products thumbnails
     */
    function renderRecentProducts() {
        const section = document.getElementById('recentProductsSection');
        const list = document.getElementById('recentProductsList');

        if (!section || !list) return;

        const recentIds = getRecentProducts();

        if (recentIds.length === 0) {
            section.style.display = 'none';
            return;
        }

        // Find products
        const recentProducts = recentIds
            .map(id => products.find(p => p.id === id))
            .filter(p => p);

        if (recentProducts.length === 0) {
            section.style.display = 'none';
            return;
        }

        list.innerHTML = recentProducts.map(p => `
            <a href="detail.html?id=${encodeURIComponent(p.id)}" class="recent-product-thumb" title="${escapeHtml(I18n.getName(p.name))}">
                <img src="${getThumbnailUrl(p)}" alt="${escapeHtml(I18n.getName(p.name))}"
                     onerror="this.onerror=null;this.src='images/placeholder.png'">
            </a>
        `).join('');

        // 'flex', not 'block' — the strip is a single row (icon | thumbs | ×)
        section.style.display = 'flex';
    }

    /**
     * Apply filters and render products
     */
    function applyFiltersAndRender() {
        const filters = Filter.getActiveFilters();

        // Filter products
        filteredProducts = products.filter(p => Filter.matchesFilters(p));

        // Calculate match scores if filters active
        if (Object.keys(filters).length > 0) {
            filteredProducts = Recommendation.sortByScore(filteredProducts, filters);
            showRecommendationPanel(true);
            updateRecommendationPanel(filters);
        } else {
            showRecommendationPanel(false);
        }

        // The chosen sort always applies (match score only ranks ahead of it)
        sortProducts();

        // Reset display
        displayedCount = 0;

        // Render
        renderProducts();
        updateResultCount();
    }

    /**
     * Sort products
     */
    function sortProducts() {
        // multiplier: 1 for asc, -1 for desc
        const multiplier = sortOrder === 'asc' ? 1 : -1;
        const diffOrder = { beginner: 1, intermediate: 2, advanced: 3 };

        filteredProducts.sort((a, b) => {
            // With filters active, better matches stay first; the selected
            // sort orders products that share a match score
            if (a.matchScore !== undefined && b.matchScore !== undefined && a.matchScore !== b.matchScore) {
                return b.matchScore - a.matchScore;
            }

            let result = 0;
            switch (currentSort) {
                case 'releaseDate':
                    result = (a.releaseYear || 0) - (b.releaseYear || 0);
                    break;
                case 'name':
                    result = I18n.getName(a.name).localeCompare(I18n.getName(b.name));
                    break;
                case 'price':
                    result = (a.price || 0) - (b.price || 0);
                    break;
                case 'difficulty':
                    result = (diffOrder[a.filterData?.difficulty] || 0) - (diffOrder[b.filterData?.difficulty] || 0);
                    break;
                case 'partCount':
                    result = (a.filterData?.partCount || 0) - (b.filterData?.partCount || 0);
                    break;
                default:
                    result = 0;
            }
            return result * multiplier;
        });
    }

    /**
     * Render the next `count` products into the grid (from displayedCount)
     */
    function renderProducts(count = ITEMS_PER_PAGE) {
        const grid = document.getElementById('productGrid');
        const noResults = document.getElementById('noResults');
        const loadMoreContainer = document.getElementById('loadMoreContainer');

        if (!grid) return;

        // Check no results
        if (filteredProducts.length === 0) {
            grid.innerHTML = '';
            renderEmptyState();
            noResults.style.display = 'flex';
            loadMoreContainer.style.display = 'none';
            return;
        }

        noResults.style.display = 'none';

        // Get items to display
        const startIndex = displayedCount;
        const endIndex = Math.min(startIndex + count, filteredProducts.length);
        const itemsToRender = filteredProducts.slice(startIndex, endIndex);

        // Clear grid if starting fresh
        if (startIndex === 0) {
            grid.innerHTML = '';
        }

        // Get template
        const template = document.getElementById('productCardTemplate');
        if (!template) return;

        // Render items into a fragment first, then insert once (one reflow)
        const fragment = document.createDocumentFragment();
        itemsToRender.forEach(product => {
            fragment.appendChild(createProductCard(product, template));
        });
        grid.appendChild(fragment);

        displayedCount = endIndex;

        // Show/hide load more
        loadMoreContainer.style.display = displayedCount < filteredProducts.length ? 'flex' : 'none';
    }

    /**
     * Re-render the grid in place (language change) without collapsing the
     * products the user already revealed with "load more"
     */
    function rerenderGrid() {
        const keep = Math.max(displayedCount, ITEMS_PER_PAGE);
        if (currentSort === 'name') sortProducts(); // name order depends on language
        displayedCount = 0;
        renderProducts(keep);
    }

    /**
     * Create product card element
     */
    function createProductCard(product, template) {
        const clone = template.content.cloneNode(true);
        const card = clone.querySelector('.product-card');

        card.setAttribute('data-id', product.id);

        // Template text is static markup — translate it for the current language
        card.querySelectorAll('[data-i18n]').forEach(el => {
            el.textContent = I18n.t(el.getAttribute('data-i18n'));
        });

        // Image - get proper gunpla.fyi URL
        const img = card.querySelector('.product-card-image img');
        img.src = getThumbnailUrl(product);
        img.alt = I18n.getName(product.name);
        img.onerror = function () { this.onerror = null; this.src = 'images/placeholder.png'; };

        // Badges
        const badges = card.querySelector('.product-card-badges');
        if (product.releaseYear >= 2024) {
            badges.innerHTML += '<span class="product-badge new">NEW</span>';
        }
        if (product.releaseLine === 'p_bandai') {
            badges.innerHTML += '<span class="product-badge p-bandai">P-Bandai</span>';
        }
        if (product.releaseLine === 'limited') {
            badges.innerHTML += '<span class="product-badge limited">Limited</span>';
        }

        // Info
        const grade = card.querySelector('.product-card-grade');
        grade.textContent = product.grade;
        grade.className = `product-card-grade ${product.grade}`;

        card.querySelector('.product-card-name').textContent = I18n.getName(product.name);

        const seriesOption = Filter.getCategory('series')?.options?.find(o => o.value === product.series);
        card.querySelector('.product-card-series').textContent = seriesOption ? I18n.getName(seriesOption.label) : product.series;

        card.querySelector('.product-price').textContent = I18n.formatPrice(product.price);
        card.querySelector('.product-year').textContent = product.releaseYear || '-';

        // Tags
        const tagsContainer = card.querySelector('.product-card-tags');
        if (product.tags) {
            product.tags.slice(0, 3).forEach(tag => {
                const tagEl = document.createElement('span');
                tagEl.className = 'product-tag';
                tagEl.textContent = tag.replace(/_/g, ' ');
                tagsContainer.appendChild(tagEl);
            });
        }

        // Stats
        const difficultyEl = card.querySelector('.stat-value.difficulty');
        const difficulty = product.filterData?.difficulty || 'beginner';
        difficultyEl.textContent = I18n.getDifficultyText(difficulty);
        difficultyEl.classList.add(difficulty);

        const mobilityBar = card.querySelector('.stat-bar-fill.mobility');
        const mobility = product.filterData?.mobility || 3;
        mobilityBar.style.width = `${(mobility / 5) * 100}%`;
        mobilityBar.parentElement.title = `${mobility}/5`;

        // Link
        card.querySelector('.product-card-link').href = `detail.html?id=${encodeURIComponent(product.id)}`;

        // Action buttons. data-id lets refreshFavCompareUI keep the active
        // state in sync everywhere (this card, other cards, cross-tab),
        // so the click handler must NOT toggle the class itself (double toggle).
        const favoriteBtn = card.querySelector('.favorite-btn');
        favoriteBtn.setAttribute('data-id', product.id);
        setToggleState(favoriteBtn, favorites.includes(product.id), 'product.addToFavorites', 'product.removeFromFavorites');
        favoriteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFavorite(product.id);
        });

        const compareBtn = card.querySelector('.compare-btn');
        compareBtn.setAttribute('data-id', product.id);
        setToggleState(compareBtn, compareList.includes(product.id), 'product.addToCompare', 'product.removeFromCompare');
        compareBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCompare(product.id);
        });

        return card;
    }

    /**
     * Reflect an on/off state on a favorite/compare button: active class,
     * aria-pressed, and an "add"/"remove" label (visible text when the button
     * has an .action-label, otherwise its accessible name)
     */
    function setToggleState(btn, active, addKey, removeKey) {
        if (!btn) return;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
        const label = I18n.t(active ? removeKey : addKey);
        const text = btn.querySelector('.action-label');
        if (text) text.textContent = label;
        else btn.setAttribute('aria-label', label);
    }

    /**
     * Update result count display
     */
    function updateResultCount() {
        const countEl = document.getElementById('resultCount');
        if (countEl) {
            countEl.textContent = filteredProducts.length;
        }
    }

    /**
     * Set the empty-state message (title + hint) from i18n keys
     */
    function setEmptyState(titleKey, hintKey) {
        const title = document.getElementById('noResultsTitle');
        const hint = document.getElementById('noResultsHint');
        if (title) title.textContent = I18n.t(titleKey);
        if (hint) hint.textContent = hintKey ? I18n.t(hintKey) : '';
    }

    /**
     * Empty-state message for the current view
     */
    function renderEmptyState() {
        if (currentPage === 'favorites') setEmptyState('favorites.empty', 'favorites.addFirst');
        else if (currentPage === 'compare') setEmptyState('compare.empty', 'compare.noItems');
        else setEmptyState('search.noResults', 'search.tryAgain');
    }

    /**
     * Show/hide loading indicator
     */
    function showLoading(show) {
        const loader = document.getElementById('loadingIndicator');
        if (loader) {
            loader.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * Show/hide recommendation panel
     * NOTE: currently dormant — index.html has no #recommendationPanel markup,
     * so this is a no-op. Implement-or-remove decision pending (task #52).
     */
    function showRecommendationPanel(show) {
        const panel = document.getElementById('recommendationPanel');
        if (panel) {
            panel.style.display = show ? 'block' : 'none';
        }
    }

    /**
     * Update recommendation panel content
     */
    function updateRecommendationPanel(filters) {
        const content = document.getElementById('recommendationContent');
        if (!content) return;

        const panelData = Recommendation.getRecommendationPanelContent(filters);

        content.innerHTML = panelData.items.map(item => `
            <div class="recommendation-item">
                <span class="recommendation-item-label">${item.label}:</span>
                <span class="recommendation-item-value">${item.value}</span>
            </div>
        `).join('');
    }

    /**
     * Toggle favorite
     */
    function toggleFavorite(productId) {
        const index = favorites.indexOf(productId);

        if (index > -1) {
            favorites.splice(index, 1);
        } else {
            favorites.push(productId);
        }
        saveFavorites();
        refreshFavCompareUI();

        // If the Favorites tab is open, immediately drop the deselected item
        if (currentPage === 'favorites' && isMainPage()) {
            showFavoritesView();
        }
    }

    /**
     * Toggle compare
     */
    function toggleCompare(productId) {
        const index = compareList.indexOf(productId);

        if (index > -1) {
            compareList.splice(index, 1);
        } else {
            if (compareList.length >= MAX_COMPARE) {
                alert(I18n.t('compare.maxItems'));
                return;
            }
            compareList.push(productId);
        }
        saveCompareList();
        compareDrawerDismissed = false; // a change brings the drawer back
        refreshFavCompareUI();

        // If the Compare tab is open, immediately reflect the change in the table
        if (currentPage === 'compare' && isMainPage()) {
            showCompareView();
        }
    }

    /**
     * Clear all favorites (with confirmation)
     */
    function clearAllFavorites() {
        if (favorites.length === 0) {
            alert(I18n.getLang() === 'ko' ? '즐겨찾기가 이미 비어있습니다.' : 'Favorites are already empty.');
            return;
        }
        const msg = I18n.getLang() === 'ko'
            ? '즐겨찾기를 모두 비우시겠습니까?'
            : 'Clear all favorites?';
        if (!confirm(msg)) return;

        favorites = [];
        saveFavorites();
        refreshFavCompareUI();

        // Refresh the favorites view if it is currently active
        if (currentPage === 'favorites' && isMainPage()) {
            showFavoritesView();
        }
    }

    /**
     * Clear all compare items (with confirmation)
     */
    function clearAllCompare() {
        if (compareList.length === 0) {
            alert(I18n.getLang() === 'ko' ? '비교함이 이미 비어있습니다.' : 'Compare list is already empty.');
            return;
        }
        const msg = I18n.getLang() === 'ko'
            ? '비교함을 모두 비우시겠습니까?'
            : 'Clear all compare items?';
        if (!confirm(msg)) return;

        clearCompareList();
    }

    /**
     * Empty the compare list and refresh every place that shows it
     */
    function clearCompareList() {
        compareList = [];
        saveCompareList();
        refreshFavCompareUI();

        // Refresh the compare view if it is currently active
        if (currentPage === 'compare' && isMainPage()) {
            showCompareView();
        }
    }

    /**
     * Wire the inconspicuous footer reset buttons (works on all pages)
     */
    function setupResetButtons() {
        const favReset = document.getElementById('clearFavoritesBtn');
        if (favReset) favReset.addEventListener('click', clearAllFavorites);

        const compReset = document.getElementById('clearCompareBtn');
        if (compReset) compReset.addEventListener('click', clearAllCompare);
    }

    /**
     * Update nav badges
     */
    function updateBadges() {
        const favBadge = document.getElementById('favoritesBadge');
        if (favBadge) favBadge.textContent = favorites.length || '';

        const compBadge = document.getElementById('compareBadge');
        if (compBadge) compBadge.textContent = compareList.length || '';
    }

    /**
     * Sync every favorite/compare UI element to the current in-memory state.
     * Used after any change (this tab or another tab) so the whole page reflects reality.
     */
    function refreshFavCompareUI() {
        updateBadges();

        document.querySelectorAll('.favorite-btn[data-id]').forEach(btn => {
            setToggleState(btn, favorites.includes(btn.getAttribute('data-id')), 'product.addToFavorites', 'product.removeFromFavorites');
        });
        document.querySelectorAll('.compare-btn[data-id]').forEach(btn => {
            setToggleState(btn, compareList.includes(btn.getAttribute('data-id')), 'product.addToCompare', 'product.removeFromCompare');
        });

        if (currentProduct) {
            setToggleState(document.getElementById('detailFavoriteBtn'),
                favorites.includes(currentProduct.id), 'product.addToFavorites', 'product.removeFromFavorites');
            setToggleState(document.getElementById('detailCompareBtn'),
                compareList.includes(currentProduct.id), 'product.addToCompare', 'product.removeFromCompare');
        }

        updateCompareDrawer();
    }

    /**
     * Read a stored id list defensively (corrupt or hand-edited storage
     * must not break the page)
     */
    function readIdList(key, max) {
        try {
            const list = JSON.parse(localStorage.getItem(key));
            if (!Array.isArray(list)) return [];
            const ids = [...new Set(list.filter(id => typeof id === 'string'))];
            return max ? ids.slice(0, max) : ids;
        } catch (e) {
            return [];
        }
    }

    /**
     * Keep favorites/compare in sync across browser tabs via the storage event.
     * (Fires only in OTHER tabs than the one that made the change.)
     */
    function setupStorageSync() {
        window.addEventListener('storage', (e) => {
            if (e.key === 'gunpla-favorites' || e.key === null) {
                favorites = readIdList('gunpla-favorites');
                refreshFavCompareUI();
                if (currentPage === 'favorites' && isMainPage()) showFavoritesView();
            }
            if (e.key === 'gunpla-compare' || e.key === null) {
                compareList = readIdList('gunpla-compare', MAX_COMPARE);
                refreshFavCompareUI();
                if (currentPage === 'compare' && isMainPage()) showCompareView();
            }
            if (e.key === RECENT_KEY || e.key === null) {
                // Keep the recently-viewed strip in sync across tabs too
                renderRecentProducts();
            }
        });
    }

    /**
     * Update compare drawer
     */
    function updateCompareDrawer() {
        const drawer = document.getElementById('compareDrawer');
        const itemsContainer = document.getElementById('compareItems');

        if (!drawer || !itemsContainer) return;

        // Hidden in the compare view itself (the table already shows the items)
        const show = compareList.length > 0 && currentPage !== 'compare' && !compareDrawerDismissed;

        itemsContainer.innerHTML = compareList.map(id => {
            const product = products.find(p => p.id === id);
            if (!product) return '';
            const name = escapeHtml(I18n.getName(product.name));

            return `
                <div class="compare-item" data-id="${escapeHtml(id)}" title="${name}">
                    <div class="compare-item-image">
                        <img src="${getThumbnailUrl(product)}" alt="${name}"
                             onerror="this.onerror=null;this.src='images/placeholder.png'">
                    </div>
                    <span class="compare-item-name">${name}</span>
                </div>
            `;
        }).join('');

        drawer.classList.toggle('active', show);
        syncCompareDrawerOffset();
    }

    /**
     * Publish the open drawer's height as --compare-drawer-offset so the
     * page bottom and the floating filter button stay clear of it
     */
    function syncCompareDrawerOffset() {
        const drawer = document.getElementById('compareDrawer');
        const h = drawer && drawer.classList.contains('active') ? drawer.offsetHeight : 0;
        document.documentElement.style.setProperty('--compare-drawer-offset', `${h}px`);
    }

    /**
     * Render compare spec table (detailed, grouped, localized)
     */
    function renderCompareTable(compProducts) {
        const section = document.getElementById('compareTableSection');
        const table = document.getElementById('compareTable');

        if (!section || !table || compProducts.length === 0) {
            if (section) section.style.display = 'none';
            return;
        }

        const lang = I18n.getLang();
        const L = (ko, en) => (lang === 'ko' ? ko : en);
        const fd = p => p.filterData || {};

        // Resolve a localized label for a taxonomy category value (O(1) category lookup)
        const taxLabel = (catId, value) => {
            if (value === undefined || value === null || value === '') return '-';
            const cat = Filter.getCategory(catId);
            const opt = cat?.options?.find(o => String(o.value) === String(value));
            return opt ? I18n.getName(opt.label) : String(value);
        };

        // Spec rows grouped into sections.
        // num: numeric accessor for best/worst highlight; better: 'high' | 'low'
        // rating: 1-5 accessor rendered as a bar (higher = better)
        const groups = [
            {
                title: L('기본 정보', 'Basics'),
                rows: [
                    { label: L('그레이드', 'Grade'), get: p => taxLabel('grade', p.grade) },
                    { label: L('스케일', 'Scale'), get: p => taxLabel('scale', p.scale) },
                    { label: L('시리즈', 'Series'), get: p => taxLabel('series', p.series) },
                    { label: L('형식번호', 'Model No.'), get: p => p.modelNumber || '-' },
                    { label: L('출시 연도', 'Release Year'), get: p => p.releaseYear || '-', num: p => p.releaseYear, better: 'high' },
                    { label: L('가격', 'Price'), get: p => I18n.formatPrice(p.price), num: p => p.price, better: 'low' },
                    { label: L('높이', 'Height'), get: p => p.height || '-' }
                ]
            },
            {
                title: L('조립 정보', 'Build'),
                rows: [
                    { label: L('난이도', 'Difficulty'), get: p => taxLabel('difficulty', fd(p).difficulty) },
                    { label: L('부품 수', 'Part Count'), get: p => fd(p).partCount ?? '-', num: p => fd(p).partCount, better: 'high' },
                    { label: L('러너 수', 'Runners'), get: p => fd(p).runnerCount ?? '-', num: p => fd(p).runnerCount, better: 'high' },
                    { label: L('프레임', 'Frame'), get: p => taxLabel('frameType', fd(p).frameType) },
                    { label: L('씰 의존도', 'Sticker Dependency'), get: p => taxLabel('sealDependency', fd(p).sealDependency) },
                    { label: L('색분할', 'Color Separation'), get: p => taxLabel('colorSeparation', fd(p).colorSeparation) }
                ]
            },
            {
                title: L('특성', 'Features'),
                rows: [
                    { label: L('가동성', 'Articulation'), get: p => fd(p).mobility ?? '-', rating: p => fd(p).mobility },
                    { label: L('무장', 'Weapons'), get: p => taxLabel('weaponCount', fd(p).weaponCount) },
                    { label: L('변형/합체', 'Transformation'), get: p => taxLabel('transformation', fd(p).transformation) },
                    { label: L('클리어 파츠', 'Clear Parts'), get: p => taxLabel('clearParts', fd(p).clearParts) },
                    { label: L('코팅 파츠', 'Coating Parts'), get: p => taxLabel('coatingParts', fd(p).coatingParts) },
                    { label: L('크기 체감', 'Size'), get: p => taxLabel('sizeFeeling', fd(p).sizeFeeling) }
                ]
            }
        ];

        const colCount = compProducts.length + 1;
        const multi = compProducts.length > 1;
        const removeLabel = escapeHtml(I18n.t('product.removeFromCompare'));

        // Header row: empty corner + one column per product
        let html = '<thead><tr><th class="corner"></th>';
        compProducts.forEach(p => {
            const name = escapeHtml(I18n.getName(p.name));
            html += `
                <td class="product-header">
                    <button class="compare-remove" data-id="${escapeHtml(p.id)}" title="${removeLabel}" aria-label="${removeLabel}: ${name}">×</button>
                    <a href="detail.html?id=${encodeURIComponent(p.id)}" class="compare-product-link">
                        <img src="${getThumbnailUrl(p)}" alt="${name}"
                             onerror="this.onerror=null;this.src='images/placeholder.png'">
                        <span class="product-name">${name}</span>
                    </a>
                </td>`;
        });
        html += '</tr></thead><tbody>';

        groups.forEach(group => {
            html += `<tr class="group-row"><th colspan="${colCount}">${group.title}</th></tr>`;

            group.rows.forEach(spec => {
                html += `<tr><th>${spec.label}</th>`;

                // Raw numeric values for highlighting
                const raws = compProducts.map(p => {
                    const src = spec.num || spec.rating;
                    if (!src) return null;
                    const n = Number(src(p));
                    return isNaN(n) ? null : n;
                });
                const valid = raws.filter(n => n !== null && n > 0);
                const maxVal = valid.length ? Math.max(...valid) : null;
                const minVal = valid.length ? Math.min(...valid) : null;

                compProducts.forEach((p, i) => {
                    let cellClass = '';
                    const raw = raws[i];

                    if (multi && (spec.num || spec.rating) && raw !== null && raw > 0 && maxVal !== minVal) {
                        const bestVal = spec.better === 'low' ? minVal : maxVal;
                        const worstVal = spec.better === 'low' ? maxVal : minVal;
                        if (raw === bestVal) cellClass = 'highlight-best';
                        else if (raw === worstVal) cellClass = 'highlight-worst';
                    }

                    let barHtml = '';
                    if (spec.rating && raw !== null && raw > 0) {
                        const percent = Math.min(100, (raw / 5) * 100);
                        barHtml = `<div class="compare-bar"><div class="compare-bar-fill" style="width: ${percent}%"></div></div>`;
                    }

                    html += `<td class="${cellClass}"><span class="cell-value">${escapeHtml(spec.get(p))}</span>${barHtml}</td>`;
                });

                html += '</tr>';
            });
        });

        html += '</tbody>';
        table.innerHTML = html;
        section.style.display = 'block';

        // Wire per-column remove buttons.
        // toggleCompare re-renders the compare view itself when it is active,
        // so no explicit re-render is needed here.
        table.querySelectorAll('.compare-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                toggleCompare(btn.getAttribute('data-id'));
            });
        });
    }

    /**
     * Open quick view modal
     * NOTE: currently dormant — there is no #quickViewModal markup or entry
     * button in the HTML, so this never runs. Implement-or-remove decision
     * pending (task #53); the modal / quick-view CSS blocks belong to it too.
     */
    function openQuickView(productId) {
        const modal = document.getElementById('quickViewModal');
        const content = document.getElementById('quickViewContent');

        if (!modal || !content) return;

        const product = products.find(p => p.id === productId);
        if (!product) return;

        const summary = Recommendation.getQuickSummary(product);
        const filters = Filter.getActiveFilters();
        const matchScore = Object.keys(filters).length > 0
            ? Recommendation.calculateMatchScore(product, filters)
            : null;

        content.innerHTML = `
            <div class="quick-view-image">
                <img src="${getThumbnailUrl(product)}" alt="${I18n.getName(product.name)}"
                     onerror="this.onerror=null;this.src='images/placeholder.png'">
            </div>
            <div class="quick-view-info">
                <span class="product-card-grade ${product.grade}">${product.grade}</span>
                <h2>${I18n.getName(product.name)}</h2>
                <p class="product-card-series">${product.series}</p>
                <div class="product-card-meta">
                    <span class="product-price">${I18n.formatPrice(product.price)}</span>
                    <span class="product-year">${product.releaseYear || '-'}</span>
                </div>
                ${matchScore !== null ? `
                    <div class="quick-view-score">
                        <span>${I18n.t('recommendation.matchScore')}: </span>
                        <strong>${matchScore}%</strong>
                    </div>
                ` : ''}
                <div class="quick-view-summary">
                    <div class="pros-section">
                        <h4>${I18n.t('product.pros')}</h4>
                        <ul>${summary.pros.map(p => `<li>✓ ${p}</li>`).join('')}</ul>
                    </div>
                    <div class="cons-section">
                        <h4>${I18n.t('product.cons')}</h4>
                        <ul>${summary.cons.map(c => `<li>✗ ${c}</li>`).join('')}</ul>
                    </div>
                </div>
                <a href="detail.html?id=${product.id}" class="product-card-link">${I18n.t('product.viewDetails')}</a>
            </div>
        `;

        modal.classList.add('active');
    }

    /**
     * Close quick view modal
     */
    function closeQuickView() {
        const modal = document.getElementById('quickViewModal');
        if (modal) modal.classList.remove('active');
    }

    /**
     * Load product detail page. Resolves to true when the product was found.
     */
    async function loadProductDetail(productId) {
        try {
            // Every indexed product has a detail file; an id that is not in the
            // index is unknown — answer without requesting a file that would 404
            if (products.length && !products.some(p => p.id === productId)) {
                showDetailNotFound();
                return false;
            }

            // Try to load detailed data
            let product;
            try {
                const response = await fetch(`data/gunpla-details/${encodeURIComponent(productId)}.json`);
                if (!response.ok) throw new Error(`Detail not found (${response.status})`);
                product = await response.json();
            } catch {
                // Fallback to index data (already loaded for the recent strip)
                product = products.find(p => p.id === productId);
            }

            if (!product) {
                console.warn('Product not found:', productId);
                showDetailNotFound();
                return false;
            }

            // Store for language change re-rendering
            currentProduct = product;
            renderProductDetail(product);
            return true;

        } catch (error) {
            console.error('Failed to load product detail:', error);
            showDetailNotFound();
            return false;
        }
    }

    /**
     * Replace the detail layout with a "product not found" message
     */
    function showDetailNotFound() {
        currentProduct = null;
        document.getElementById('detailContainer')?.setAttribute('hidden', '');
        document.getElementById('breadcrumb')?.setAttribute('hidden', '');
        document.getElementById('detailNotFound')?.removeAttribute('hidden');
        document.title = `${I18n.t('product.notFound')} | ${I18n.t('site.title')}`;
    }

    /**
     * Render product detail page
     */
    function renderProductDetail(product) {
        document.getElementById('detailNotFound')?.setAttribute('hidden', '');
        document.getElementById('detailContainer')?.removeAttribute('hidden');
        document.getElementById('breadcrumb')?.removeAttribute('hidden');

        // Update page title
        document.title = `${I18n.getName(product.name)} | ${I18n.t('site.title')}`;

        // Breadcrumb
        document.getElementById('breadcrumbGrade').textContent = product.grade;
        document.getElementById('breadcrumbCurrent').textContent = I18n.getName(product.name);

        // Image gallery (main image + thumbnails + prev/next navigation)
        renderGallery(product);

        // Badges
        const badges = document.getElementById('detailBadges');
        badges.innerHTML = `<span class="product-card-grade ${escapeHtml(product.grade)}">${escapeHtml(product.grade)}</span>`;
        if (product.isVerKa) badges.innerHTML += '<span class="product-badge limited">Ver.Ka</span>';
        if (product.isRevive) badges.innerHTML += '<span class="product-badge new">Revive</span>';

        // Header info
        document.getElementById('detailName').textContent = I18n.getName(product.name);

        const seriesOption = Filter.getCategory('series')?.options?.find(o => o.value === product.series);
        document.getElementById('detailSeries').textContent = seriesOption ? I18n.getName(seriesOption.label) : product.series;

        document.getElementById('detailModel').textContent = `${I18n.t('product.modelNumber')}: ${product.modelNumber || '-'}`;

        // Meta
        document.getElementById('detailPrice').textContent = I18n.formatPrice(product.price);
        document.getElementById('detailReleaseDate').textContent = I18n.formatDate(product.releaseYear, product.releaseMonth);
        document.getElementById('detailHeight').textContent = product.height || '-';

        // Recommendation (optional elements - may have been removed)
        const matchScore = product.recommendation?.matchScore || 85;
        const matchScoreEl = document.getElementById('matchScoreValue');
        if (matchScoreEl) matchScoreEl.textContent = matchScore;
        const reasonEl = document.getElementById('recommendationReason');
        if (reasonEl) {
            reasonEl.textContent = I18n.getName(product.recommendation?.reasoning) || I18n.t('recommendation.basedOnFilters');
        }

        // Specs
        renderSpecs(product);

        // Pros/Cons
        renderProsCons(product);

        // Variants
        renderVariants(product);

        const localized = obj => (obj ? (I18n.getLang() === 'ko' ? obj.ko : obj.en) || [] : []);

        // Weapons & Accessories
        const weaponsList = document.getElementById('weaponsList');
        if (weaponsList) {
            const allItems = [...localized(product.weapons), ...localized(product.accessories)];
            weaponsList.innerHTML = allItems.map(w => `<span class="product-tag">${escapeHtml(w)}</span>`).join('');
            weaponsList.closest('.detail-weapons')?.toggleAttribute('hidden', allItems.length === 0);
        }

        // Recommended for
        const recList = document.getElementById('recommendedForList');
        if (recList) {
            const items = localized(product.recommendation?.perfectFor);
            recList.innerHTML = items.map(item => `<li>• ${escapeHtml(item)}</li>`).join('');
            recList.closest('.detail-recommended-for')?.toggleAttribute('hidden', items.length === 0);
        }

        // Building tips
        const tipsList = document.getElementById('tipsList');
        if (tipsList) {
            const tips = localized(product.buildingTips);
            tipsList.innerHTML = tips.map(tip => `<li>💡 ${escapeHtml(tip)}</li>`).join('');
            document.getElementById('detailTips')?.toggleAttribute('hidden', tips.length === 0);
        }

        // Setup tabs
        setupDetailTabs();

        // Actions
        setupDetailActions(product);
    }

    /**
     * Render the detail-page image gallery: main image, thumbnails, prev/next.
     * Falls back to the index thumbnail when no usable gallery data exists.
     */
    function renderGallery(product) {
        const mainImage = document.getElementById('mainImage');
        if (!mainImage) return;

        const images = [product.images?.boxart, ...(product.images?.gallery || [])]
            .filter(url => url && isUsableImageUrl(url))
            .map(normalizeImageUrl);
        if (images.length === 0) {
            // Same image as the product card (index thumbnail), not a blank placeholder
            const indexEntry = products.find(p => p.id === product.id) || product;
            images.push(getThumbnailUrl(indexEntry));
        }

        galleryImages = images;
        mainImage.alt = I18n.getName(product.name);
        setGalleryImage(0);

        // Hide navigation when there is nothing to navigate
        const multiple = images.length > 1;
        const prevBtn = document.getElementById('galleryPrev');
        const nextBtn = document.getElementById('galleryNext');
        if (prevBtn) prevBtn.style.display = multiple ? '' : 'none';
        if (nextBtn) nextBtn.style.display = multiple ? '' : 'none';

        const thumbs = document.getElementById('galleryThumbnails');
        if (thumbs) {
            thumbs.innerHTML = multiple ? images.map((src, i) => `
                <button type="button" class="gallery-thumbnail${i === 0 ? ' active' : ''}" data-index="${i}" aria-label="${i + 1} / ${images.length}">
                    <img src="${escapeHtml(src)}" alt="" loading="lazy"
                         onerror="this.onerror=null;this.src='images/placeholder.png'">
                </button>
            `).join('') : '';
            thumbs.querySelectorAll('.gallery-thumbnail').forEach(btn => {
                btn.addEventListener('click', () => {
                    setGalleryImage(Number(btn.getAttribute('data-index')));
                });
            });
        }

        // Wire prev/next only once (renderProductDetail re-runs on language change)
        if (!galleryWired && (prevBtn || nextBtn)) {
            if (prevBtn) prevBtn.addEventListener('click', () => setGalleryImage(galleryIndex - 1));
            if (nextBtn) nextBtn.addEventListener('click', () => setGalleryImage(galleryIndex + 1));
            galleryWired = true;
        }
    }

    /**
     * Show gallery image at index (wraps around) and sync thumbnail states
     */
    function setGalleryImage(index) {
        const mainImage = document.getElementById('mainImage');
        if (!mainImage || galleryImages.length === 0) return;

        galleryIndex = ((index % galleryImages.length) + galleryImages.length) % galleryImages.length;

        // Re-arm the fallback each swap (onerror clears itself after firing)
        mainImage.onerror = function () { this.onerror = null; this.src = 'images/placeholder.png'; };
        mainImage.src = galleryImages[galleryIndex];

        document.querySelectorAll('#galleryThumbnails .gallery-thumbnail').forEach((t, i) => {
            t.classList.toggle('active', i === galleryIndex);
        });
    }

    /**
     * Render specs grid
     */
    function renderSpecs(product) {
        const grid = document.getElementById('specsGrid');
        if (!grid) return;

        const specs = product.fullSpecs || product.filterData || {};

        const specItems = [
            { key: 'partCount', label: I18n.t('product.partCount') },
            { key: 'runnerCount', label: I18n.t('product.runnerCount') },
            { key: 'difficulty', label: I18n.t('product.difficulty') },
            { key: 'mobility', label: I18n.t('product.mobility') },
            { key: 'frameType', label: I18n.getLang() === 'ko' ? '프레임' : 'Frame' },
            { key: 'colorSeparation', label: I18n.getLang() === 'ko' ? '색분할' : 'Color Sep.' },
            { key: 'sealDependency', label: I18n.getLang() === 'ko' ? '씰 의존도' : 'Sticker Dep.' },
            { key: 'transformation', label: I18n.getLang() === 'ko' ? '변형' : 'Transformation' }
        ];

        grid.innerHTML = specItems.map(({ key, label }) => {
            let value = specs[key];
            if (value === undefined) return '';

            // Format value
            if (key === 'difficulty') {
                value = I18n.getDifficultyText(value);
            } else if (key === 'mobility') {
                value = `${value}/5`;
            } else if (typeof value === 'boolean') {
                value = value ? (I18n.getLang() === 'ko' ? '있음' : 'Yes') : (I18n.getLang() === 'ko' ? '없음' : 'No');
            } else {
                const category = Filter.getCategory(key);
                const option = category?.options?.find(o => o.value === value);
                if (option) value = I18n.getName(option.label);
            }

            return `
                <div class="spec-item">
                    <span class="spec-label">${escapeHtml(label)}</span>
                    <span class="spec-value">${escapeHtml(value)}</span>
                </div>
            `;
        }).filter(Boolean).join('');
    }

    /**
     * Render pros and cons
     */
    function renderProsCons(product) {
        const prosList = document.getElementById('prosList');
        const consList = document.getElementById('consList');

        if (prosList && product.pros) {
            const pros = I18n.getLang() === 'ko' ? product.pros.ko : product.pros.en;
            prosList.innerHTML = pros?.map(p => `<li>${p}</li>`).join('') || '';
        }

        if (consList && product.cons) {
            const cons = I18n.getLang() === 'ko' ? product.cons.ko : product.cons.en;
            consList.innerHTML = cons?.map(c => `<li>${c}</li>`).join('') || '';
        }
    }

    /**
     * Render variants
     */
    function renderVariants(product) {
        const variantsGrid = document.getElementById('variantsGrid');
        const relatedGrades = document.getElementById('relatedGrades');
        const unavailableTitle = escapeHtml(I18n.t('product.detailsUnavailable'));
        const variants = product.variants || [];
        const related = product.relatedGrades || [];

        // Color/Config variants — resolve the real thumbnail from the product
        // index (the previous random gunpla.fyi id showed unrelated boxarts).
        // Items whose id is not in the index have no detail page, so they are
        // rendered as non-clickable cards instead of broken links.
        if (variantsGrid) {
            variantsGrid.innerHTML = variants.map(v => {
                const variantProduct = products.find(p => p.id === v.id);
                const imgSrc = variantProduct ? getThumbnailUrl(variantProduct) : 'images/placeholder.png';
                const name = escapeHtml(I18n.getName(v.name));
                const inner = `
                    <img src="${imgSrc}"
                         alt="${name}" class="variant-image"
                         onerror="this.onerror=null;this.src='images/placeholder.png'">
                    <div class="variant-info">
                        <span class="variant-type">${escapeHtml(v.variantType)}</span>
                        <span class="variant-name">${name}</span>
                    </div>`;
                if (!variantProduct) {
                    return `<div class="variant-card unavailable" data-id="${escapeHtml(v.id)}" title="${unavailableTitle}">${inner}</div>`;
                }
                return `<a href="detail.html?id=${encodeURIComponent(v.id)}" class="variant-card ${v.id === product.id ? 'current' : ''}" data-id="${escapeHtml(v.id)}">${inner}</a>`;
            }).join('');
            variantsGrid.closest('.variants-section')?.toggleAttribute('hidden', variants.length === 0);
        }

        // Related grades (different grade same MS)
        if (relatedGrades) {
            relatedGrades.innerHTML = related.map(r => {
                const exists = products.some(p => p.id === r.id);
                const inner = `
                    <span class="grade-badge product-card-grade ${escapeHtml(r.grade)}">${escapeHtml(r.grade)}</span>
                    <span class="grade-name">${escapeHtml(I18n.getName(r.name))}</span>`;
                if (!exists) {
                    return `<div class="related-grade-item unavailable" data-id="${escapeHtml(r.id)}" title="${unavailableTitle}">${inner}</div>`;
                }
                return `<a href="detail.html?id=${encodeURIComponent(r.id)}" class="related-grade-item" data-id="${escapeHtml(r.id)}">${inner}</a>`;
            }).join('');
            relatedGrades.closest('.related-grades-section')?.toggleAttribute('hidden', related.length === 0);
        }

        // No variant data at all → drop the tab instead of showing empty headings
        const variantsTabBtn = document.querySelector('.tab-btn[data-tab="variants"]');
        if (variantsTabBtn) {
            const empty = variants.length === 0 && related.length === 0;
            variantsTabBtn.toggleAttribute('hidden', empty);
            if (empty && variantsTabBtn.classList.contains('active')) activateDetailTab('specs');
        }
    }

    /**
     * Switch the detail page to the given tab ('specs' | 'variants')
     */
    function activateDetailTab(tabId, focus = false) {
        document.querySelectorAll('.tab-btn').forEach(t => {
            const isActive = t.getAttribute('data-tab') === tabId;
            t.classList.toggle('active', isActive);
            t.setAttribute('aria-selected', String(isActive));
            t.tabIndex = isActive ? 0 : -1;
            if (isActive && focus) t.focus();
        });
        document.querySelectorAll('.tab-content').forEach(c => {
            c.classList.toggle('active', c.id === `${tabId}Tab`);
        });
    }

    /**
     * Setup detail page tabs
     */
    function setupDetailTabs() {
        // Wire only once — renderProductDetail re-runs on every language
        // change and would otherwise stack duplicate click listeners
        if (detailTabsWired) return;
        detailTabsWired = true;

        const tabs = Array.from(document.querySelectorAll('.tab-btn'));

        tabs.forEach(tab => {
            tab.addEventListener('click', () => activateDetailTab(tab.getAttribute('data-tab')));

            // Arrow keys move between visible tabs (WAI-ARIA tabs pattern)
            tab.addEventListener('keydown', (e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                const visible = tabs.filter(t => !t.hidden);
                const i = visible.indexOf(tab);
                const next = visible[(i + (e.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length];
                if (next) activateDetailTab(next.getAttribute('data-tab'), true);
            });
        });
    }

    /**
     * Setup detail page action buttons
     */
    function setupDetailActions(product) {
        const favBtn = document.getElementById('detailFavoriteBtn');
        const compBtn = document.getElementById('detailCompareBtn');
        const manualBtn = document.getElementById('detailManualBtn');

        // Reflect current state + localized labels on every render (safe to run repeatedly)
        setToggleState(favBtn, favorites.includes(product.id), 'product.addToFavorites', 'product.removeFromFavorites');
        setToggleState(compBtn, compareList.includes(product.id), 'product.addToCompare', 'product.removeFromCompare');

        // Attach click handlers only ONCE — renderProductDetail can run again
        // (e.g. on language change), so guarding prevents listener stacking and
        // the resulting multi-toggle bug. Handlers read currentProduct at click
        // time; toggleFavorite/toggleCompare already update the button's state.
        if (!detailActionsWired) {
            if (favBtn) {
                favBtn.addEventListener('click', () => {
                    if (currentProduct) toggleFavorite(currentProduct.id);
                });
            }
            if (compBtn) {
                compBtn.addEventListener('click', () => {
                    if (currentProduct) toggleCompare(currentProduct.id);
                });
            }
            detailActionsWired = true;
        }

        // Bandai official manual link.
        // NOTE: the boxart/thumbnail number is a gunpla.fyi image id, NOT a Bandai
        // manual id, so it must NOT be used for /menus/detail/{id}. A real manual id
        // is only used when explicitly present in the data; otherwise we link to the
        // official manual KEYWORD SEARCH, which always resolves to a valid page.
        if (manualBtn) {
            const manualId = product.bandaiManualId || product.manualId;

            if (manualId) {
                // Direct manual page (only when a verified Bandai manual id exists)
                manualBtn.href = `https://manual.bandai-hobby.net/menus/detail/${encodeURIComponent(manualId)}`;
                manualBtn.removeAttribute('title');
            } else {
                // Search the official manual site by grade + model number / name
                const keyword = [product.grade, product.modelNumber || I18n.getName(product.name)]
                    .filter(Boolean)
                    .map(s => encodeURIComponent(String(s).trim()))
                    .join('+');
                manualBtn.href = `https://manual.bandai-hobby.net/menus?keyword=${keyword}`;
                manualBtn.title = I18n.t('product.manualSearchHint');
            }

            manualBtn.style.display = 'flex';
        }
    }

    /**
     * Save favorites to localStorage
     */
    function saveFavorites() {
        try {
            localStorage.setItem('gunpla-favorites', JSON.stringify(favorites));
        } catch (e) {
            console.warn('Failed to save favorites:', e);
        }
    }

    /**
     * Save compare list to localStorage
     */
    function saveCompareList() {
        try {
            localStorage.setItem('gunpla-compare', JSON.stringify(compareList));
        } catch (e) {
            console.warn('Failed to save compare list:', e);
        }
    }

    /**
     * Load saved data from localStorage
     */
    function loadSavedData() {
        favorites = readIdList('gunpla-favorites');
        compareList = readIdList('gunpla-compare', MAX_COMPARE);
        refreshFavCompareUI();
    }

    function isMainPage() {
        return !document.body.classList.contains('detail-page');
    }

    // ===== Views (home / favorites / compare) and history =====

    function getViewFromURL() {
        const view = new URLSearchParams(window.location.search).get('view');
        return VIEWS.includes(view) ? view : 'home';
    }

    /**
     * User navigation to a view: adds a history entry (keeps the current
     * filter/search params) so Back returns to the previous view
     */
    function navigateTo(view) {
        if (!VIEWS.includes(view)) view = 'home';
        if (view !== getViewFromURL()) {
            const params = new URLSearchParams(window.location.search);
            if (view === 'home') params.delete('view');
            else params.set('view', view);
            const qs = params.toString();
            window.history.pushState({ view }, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
        }
        renderView(view);
    }

    function renderView(view) {
        if (view === 'favorites') showFavoritesView();
        else if (view === 'compare') showCompareView();
        else showHomeView();
    }

    /**
     * Highlight the nav entry for the current view (desktop + mobile menu)
     */
    function setActiveNav(view) {
        document.querySelectorAll('.nav-item[data-page], .mobile-nav-item[data-page]').forEach(n => {
            const isActive = n.getAttribute('data-page') === view;
            n.classList.toggle('active', isActive);
            if (isActive) n.setAttribute('aria-current', 'page');
            else n.removeAttribute('aria-current');
        });
    }

    // ===== Off-canvas panels (mobile menu, filter sidebar) =====

    function setMobileMenuOpen(open) {
        const btn = document.getElementById('mobileMenuBtn');
        const overlay = document.getElementById('mobileMenuOverlay');
        if (!btn || !overlay) return;
        btn.classList.toggle('active', open);
        overlay.classList.toggle('active', open);
        btn.setAttribute('aria-expanded', String(open));
        if (open) setFilterPanelOpen(false);
    }

    function setFilterPanelOpen(open) {
        const sidebar = document.getElementById('filterSidebar');
        const toggle = document.getElementById('mobileFilterBtn');
        if (!sidebar || !toggle) return;
        const wasOpen = sidebar.classList.contains('active');
        sidebar.classList.toggle('active', open);
        document.body.classList.toggle('filter-open', open);
        const backdrop = document.getElementById('filterBackdrop');
        if (backdrop) backdrop.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        if (open && !wasOpen) {
            setMobileMenuOpen(false);
            document.getElementById('filterCloseBtn')?.focus();
        } else if (!open && wasOpen && sidebar.contains(document.activeElement)) {
            toggle.focus();
        }
    }

    /**
     * Hamburger menu shared by both pages: toggle, backdrop click, Escape,
     * and auto-close when the viewport grows past the hamburger breakpoint
     */
    function setupMobileMenu() {
        const btn = document.getElementById('mobileMenuBtn');
        const overlay = document.getElementById('mobileMenuOverlay');
        if (!btn || !overlay) return;

        btn.addEventListener('click', () => setMobileMenuOpen(!overlay.classList.contains('active')));

        // Tapping the dimmed area below the menu closes it
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) setMobileMenuOpen(false);
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (overlay.classList.contains('active')) {
                setMobileMenuOpen(false);
                btn.focus();
            }
            if (document.getElementById('filterSidebar')?.classList.contains('active')) {
                setFilterPanelOpen(false);
            }
        });

        // Both panels only exist below 1024px; close them when leaving that
        // range so a stale backdrop can't cover the desktop layout
        const compact = window.matchMedia('(max-width: 1024px)');
        compact.addEventListener('change', (e) => {
            if (!e.matches) {
                setMobileMenuOpen(false);
                setFilterPanelOpen(false);
            }
        });
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Filter / search change — always shows the filtered catalog.
        // (Filter.updateURL has already dropped ?view= from the address.)
        document.addEventListener('filterChange', () => {
            if (currentPage !== 'home') showHomeView();
            else applyFiltersAndRender();
        });

        // Back / forward between views: restore filters + view from the URL
        window.addEventListener('popstate', () => {
            Filter.syncFromURL();
            renderView(getViewFromURL());
        });

        // Language change - re-render the current view in the new language
        document.addEventListener('langChange', () => {
            if (currentPage === 'compare') {
                showCompareView();
            } else {
                rerenderGrid();
                updateRecommendationPanel(Filter.getActiveFilters());
            }
            renderRecentProducts();
            refreshFavCompareUI(); // localized button labels + drawer names
        });

        // Language toggle
        document.querySelectorAll('.lang-toggle, .mobile-lang-toggle').forEach(btn => {
            btn.addEventListener('click', I18n.toggleLang);
        });

        // Mobile menu
        setupMobileMenu();

        // Mobile filter panel
        document.getElementById('mobileFilterBtn')?.addEventListener('click', () => {
            setFilterPanelOpen(!document.getElementById('filterSidebar')?.classList.contains('active'));
        });
        document.getElementById('filterCloseBtn')?.addEventListener('click', () => setFilterPanelOpen(false));
        document.getElementById('filterBackdrop')?.addEventListener('click', () => setFilterPanelOpen(false));

        // Sort
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                currentSort = e.target.value;
                sortProducts();
                displayedCount = 0;
                renderProducts();
            });
        }

        // Sort order toggle (asc/desc)
        const sortOrderToggle = document.getElementById('sortOrderToggle');
        if (sortOrderToggle) {
            sortOrderToggle.addEventListener('click', () => {
                sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
                const label = sortOrderToggle.querySelector('.sort-order-label');
                if (label) {
                    label.textContent = sortOrder === 'desc' ? '↓' : '↑';
                }
                sortOrderToggle.classList.toggle('asc', sortOrder === 'asc');
                sortProducts();
                displayedCount = 0;
                renderProducts();
            });
        }

        // View toggle
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.view-btn').forEach(b => {
                    b.classList.toggle('active', b === btn);
                    b.setAttribute('aria-pressed', String(b === btn));
                });
                currentView = btn.getAttribute('data-view');
                document.getElementById('productGrid')?.classList.toggle('list-view', currentView === 'list');
            });
        });

        // Load more (wrapped: the click event must not become the count argument)
        const loadMoreBtn = document.getElementById('loadMoreBtn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', () => renderProducts());
        }

        // Quick view close
        const quickViewClose = document.getElementById('quickViewClose');
        const quickViewModal = document.getElementById('quickViewModal');
        if (quickViewClose) {
            quickViewClose.addEventListener('click', closeQuickView);
        }
        if (quickViewModal) {
            quickViewModal.addEventListener('click', (e) => {
                if (e.target === quickViewModal) closeQuickView();
            });
        }

        // Compare drawer
        const compareDrawer = document.getElementById('compareDrawer');
        const compareDrawerClose = document.getElementById('compareDrawerClose');
        if (compareDrawerClose) {
            compareDrawerClose.addEventListener('click', () => {
                compareDrawerDismissed = true;
                updateCompareDrawer();
            });
        }

        // "Compare" opens the compare view (spec table)
        document.getElementById('compareSubmitBtn')?.addEventListener('click', () => {
            navigateTo('compare');
            window.scrollTo({ top: 0 });
        });

        document.getElementById('compareClearBtn')?.addEventListener('click', clearCompareList);

        // Drawer height changes with its content and the breakpoint
        if (compareDrawer && 'ResizeObserver' in window) {
            new ResizeObserver(syncCompareDrawerOffset).observe(compareDrawer);
        }

        // Clear recent products button
        const clearRecentBtn = document.getElementById('clearRecentBtn');
        if (clearRecentBtn) {
            clearRecentBtn.addEventListener('click', clearRecentProducts);
        }

        // Inconspicuous footer reset buttons (favorites / compare)
        setupResetButtons();

        // Cross-tab favorites/compare synchronization
        setupStorageSync();

        // Navigation: desktop nav + mobile menu (home / favorites / compare).
        // Links carry real hrefs (open-in-new-tab works); a plain click is
        // handled in-page and recorded in history.
        document.querySelectorAll('.nav-item[data-page], .mobile-nav-item[data-page]').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                navigateTo(item.getAttribute('data-page'));
                setMobileMenuOpen(false);
            });
        });
    }

    /**
     * Show favorites view
     */
    function showFavoritesView() {
        currentPage = 'favorites';
        setActiveNav('favorites');

        // Restore normal grid layout (in case we came from compare view)
        exitCompareLayout();

        // Hide recommendation panel
        showRecommendationPanel(false);

        // Favorites in catalog order, then the selected sort
        filteredProducts = products.filter(p => favorites.includes(p.id));
        sortProducts();
        displayedCount = 0;

        updateResultCount();
        renderProducts();
        updateCompareDrawer();
    }

    /**
     * Show compare view
     */
    function showCompareView() {
        currentPage = 'compare';
        setActiveNav('compare');

        // Filter to show only compare items (in the order they were added)
        const compProducts = compareList
            .map(id => products.find(p => p.id === id))
            .filter(Boolean);

        // Hide recommendation panel
        showRecommendationPanel(false);

        // Update result count
        const countEl = document.getElementById('resultCount');
        if (countEl) countEl.textContent = compProducts.length;

        const grid = document.getElementById('productGrid');
        const noResults = document.getElementById('noResults');
        const loadMoreContainer = document.getElementById('loadMoreContainer');
        const controlGroup = document.querySelector('.control-group');
        const tableSection = document.getElementById('compareTableSection');

        // Compare view shows ONLY the spec table — not the main-page product cards
        if (grid) { grid.innerHTML = ''; grid.style.display = 'none'; }
        if (loadMoreContainer) loadMoreContainer.style.display = 'none';
        if (controlGroup) controlGroup.style.display = 'none';

        if (compProducts.length === 0) {
            if (noResults) {
                renderEmptyState();
                noResults.style.display = 'flex';
            }
            if (tableSection) tableSection.style.display = 'none';
        } else {
            if (noResults) noResults.style.display = 'none';
            renderCompareTable(compProducts);
        }

        // The drawer is redundant here — hide it
        updateCompareDrawer();
    }

    /**
     * Restore the normal grid layout when leaving compare view
     */
    function exitCompareLayout() {
        const grid = document.getElementById('productGrid');
        const controlGroup = document.querySelector('.control-group');
        const tableSection = document.getElementById('compareTableSection');
        if (grid) grid.style.display = '';
        if (controlGroup) controlGroup.style.display = '';
        if (tableSection) tableSection.style.display = 'none';
    }

    /**
     * Show home view (reset to normal)
     */
    function showHomeView() {
        currentPage = 'home';
        setActiveNav('home');

        // Restore normal grid layout (in case we came from compare view)
        exitCompareLayout();

        // Re-apply filters and render
        applyFiltersAndRender();
        updateCompareDrawer();
    }

    /**
     * Initialize the detail page (detail.html?id=...)
     */
    async function initDetail() {
        await I18n.init();
        I18n.initTheme(); // Apply saved theme
        // Await: renderProductDetail resolves labels via Filter.getCategory,
        // so the taxonomy must be loaded before the product renders
        await Filter.init();

        // Load saved favorites and compare data (updates nav badges)
        loadSavedData();

        // Load the product index so the recent-viewed strip can render thumbnails
        await loadProducts();

        // Load product from URL parameter
        const productId = new URLSearchParams(window.location.search).get('id');
        const found = productId ? await loadProductDetail(productId) : false;
        if (!productId) showDetailNotFound();

        // Track as recently viewed only when the product exists (also renders the strip)
        if (found) addToRecent(productId);
        else renderRecentProducts();

        // Re-render the product in the new language
        document.addEventListener('langChange', () => {
            if (currentProduct) renderProductDetail(currentProduct);
            else showDetailNotFound();
            renderRecentProducts();
        });

        // Wire the "clear recent" button on the detail page
        document.getElementById('clearRecentBtn')?.addEventListener('click', clearRecentProducts);

        // Wire the inconspicuous footer reset buttons on the detail page
        setupResetButtons();

        // Cross-tab favorites/compare synchronization
        setupStorageSync();

        // Setup tabs immediately (don't depend on data load)
        setupDetailTabs();

        // Language toggle
        document.querySelectorAll('.lang-toggle, .mobile-lang-toggle').forEach(btn => {
            btn.addEventListener('click', I18n.toggleLang);
        });

        // Mobile menu
        setupMobileMenu();
    }

    // Public API
    return {
        init,
        initDetail,
        loadProductDetail,
        toggleFavorite,
        toggleCompare,
        setupDetailTabs,
        getProducts: () => products,
        addToRecent,
        loadProducts,
        renderRecentProducts,
        clearRecentProducts,
        clearAllFavorites,
        clearAllCompare,
        setupResetButtons,
        setupStorageSync,
        updateBadges
    };
})();

// Export
window.GunplaApp = GunplaApp;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    if (document.body.classList.contains('detail-page')) {
        GunplaApp.initDetail();
    } else {
        GunplaApp.init();
    }
});
