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
    const ITEMS_PER_PAGE = 24;

    // Favorites and Compare
    let favorites = [];
    let compareList = [];
    const MAX_COMPARE = 4;
    let detailActionsWired = false; // guard so detail buttons are wired only once

    // Recently Viewed
    const RECENT_KEY = 'gunpla-recent-viewed';
    const MAX_RECENT = 10;

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
            await loadProducts();

            // Setup event listeners
            setupEventListeners();

            // Load saved data
            loadSavedData();

            // Initial render
            applyFiltersAndRender();
            renderRecentProducts();

            showLoading(false);

        } catch (error) {
            console.error('App initialization failed:', error);
            showLoading(false);
        }
    }

    /**
     * Load products from JSON
     */
    async function loadProducts() {
        try {
            const response = await fetch('data/gunpla-index.json');
            const data = await response.json();
            products = data.products || [];
        } catch (error) {
            console.error('Failed to load products:', error);
            products = [];
        }
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
        if (product.thumbnail) {
            let url = product.thumbnail;

            // Check if it's a gunpla.fyi URL
            if (url.includes('gunpla.fyi/images/boxarts/')) {
                // Add .jpeg extension if missing
                if (!url.endsWith('.jpeg') && !url.endsWith('.jpg') && !url.endsWith('.png')) {
                    url = url + '.jpeg';
                }
                return url;
            }

            return url;
        }

        return 'images/placeholder.png';
    }

    /**
     * Get recently viewed products from localStorage
     */
    function getRecentProducts() {
        try {
            const data = localStorage.getItem(RECENT_KEY);
            return data ? JSON.parse(data) : [];
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
            renderRecentProducts();
        } catch (e) {
            console.warn('Failed to clear recent products:', e);
        }
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
            <a href="detail.html?id=${p.id}" class="recent-product-thumb" title="${I18n.getName(p.name)}">
                <img src="${getThumbnailUrl(p)}" alt="${I18n.getName(p.name)}" 
                     onerror="this.src='images/placeholder.png'">
            </a>
        `).join('');

        section.style.display = 'block';
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
            // Apply regular sorting
            sortProducts();
        }

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
        const filters = Filter.getActiveFilters();

        // If filters active, keep score-based sorting
        if (Object.keys(filters).length > 0) return;

        // multiplier: 1 for asc, -1 for desc
        const multiplier = sortOrder === 'asc' ? 1 : -1;

        filteredProducts.sort((a, b) => {
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
                    const diffOrder = { beginner: 1, intermediate: 2, advanced: 3 };
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
     * Render products to grid
     */
    function renderProducts() {
        const grid = document.getElementById('productGrid');
        const noResults = document.getElementById('noResults');
        const loadMoreContainer = document.getElementById('loadMoreContainer');

        if (!grid) return;

        // Check no results
        if (filteredProducts.length === 0) {
            grid.innerHTML = '';
            noResults.style.display = 'flex';
            loadMoreContainer.style.display = 'none';
            return;
        }

        noResults.style.display = 'none';

        // Get items to display
        const startIndex = displayedCount;
        const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, filteredProducts.length);
        const itemsToRender = filteredProducts.slice(startIndex, endIndex);

        // Clear grid if starting fresh
        if (startIndex === 0) {
            grid.innerHTML = '';
        }

        // Get template
        const template = document.getElementById('productCardTemplate');
        if (!template) return;

        // Render items
        itemsToRender.forEach(product => {
            const card = createProductCard(product, template);
            grid.appendChild(card);
        });

        displayedCount = endIndex;

        // Show/hide load more
        loadMoreContainer.style.display = displayedCount < filteredProducts.length ? 'flex' : 'none';
    }

    /**
     * Create product card element
     */
    function createProductCard(product, template) {
        const clone = template.content.cloneNode(true);
        const card = clone.querySelector('.product-card');


        card.setAttribute('data-id', product.id);

        // Image - get proper gunpla.fyi URL
        const img = card.querySelector('.product-card-image img');
        img.src = getThumbnailUrl(product);
        img.alt = I18n.getName(product.name);
        img.onerror = function () { this.src = 'images/placeholder.png'; };

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

        const taxonomy = Filter.getTaxonomy();
        const seriesOption = taxonomy?.categories?.find(c => c.id === 'series')?.options?.find(o => o.value === product.series);
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

        // Link
        card.querySelector('.product-card-link').href = `detail.html?id=${product.id}`;

        // Action buttons. data-id lets toggleFavorite/toggleCompare keep the
        // active state in sync everywhere (this card, other cards, cross-tab),
        // so the click handler must NOT toggle the class itself (double toggle).
        const favoriteBtn = card.querySelector('.favorite-btn');
        favoriteBtn.setAttribute('data-id', product.id);
        if (favorites.includes(product.id)) {
            favoriteBtn.classList.add('active');
        }
        favoriteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFavorite(product.id);
        });

        const compareBtn = card.querySelector('.compare-btn');
        compareBtn.setAttribute('data-id', product.id);
        if (compareList.includes(product.id)) {
            compareBtn.classList.add('active');
        }
        compareBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCompare(product.id);
        });

        return card;
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
        const isNowFavorite = index === -1;

        if (index > -1) {
            favorites.splice(index, 1);
        } else {
            favorites.push(productId);
        }
        saveFavorites();
        updateBadges();

        // Immediately update all matching buttons in the DOM
        document.querySelectorAll(`.favorite-btn[data-id="${productId}"]`).forEach(btn => {
            btn.classList.toggle('active', isNowFavorite);
        });

        // Also update detail page button if present
        const detailFavBtn = document.getElementById('detailFavoriteBtn');
        if (detailFavBtn) {
            detailFavBtn.classList.toggle('active', isNowFavorite);
        }

        // If the Favorites tab is open, immediately drop the deselected item
        if (document.getElementById('favoritesNav')?.classList.contains('active')) {
            showFavoritesView();
        }
    }

    /**
     * Toggle compare
     */
    function toggleCompare(productId) {
        const index = compareList.indexOf(productId);
        const isNowInCompare = index === -1;

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
        updateBadges();
        updateCompareDrawer();

        // Immediately update all matching buttons in the DOM
        document.querySelectorAll(`.compare-btn[data-id="${productId}"]`).forEach(btn => {
            btn.classList.toggle('active', isNowInCompare);
        });

        // Also update detail page button if present
        const detailCompBtn = document.getElementById('detailCompareBtn');
        if (detailCompBtn) {
            detailCompBtn.classList.toggle('active', isNowInCompare);
        }

        // If the Compare tab is open, immediately reflect the change in the table
        if (document.getElementById('compareNav')?.classList.contains('active')) {
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
        updateBadges();

        // Clear active states across the DOM
        document.querySelectorAll('.favorite-btn.active').forEach(b => b.classList.remove('active'));
        document.getElementById('detailFavoriteBtn')?.classList.remove('active');

        // Refresh the favorites view if it is currently active
        if (document.getElementById('favoritesNav')?.classList.contains('active')) {
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

        compareList = [];
        saveCompareList();
        updateBadges();
        updateCompareDrawer();

        // Clear active states across the DOM
        document.querySelectorAll('.compare-btn.active').forEach(b => b.classList.remove('active'));
        document.getElementById('detailCompareBtn')?.classList.remove('active');

        // Refresh the compare view if it is currently active
        if (document.getElementById('compareNav')?.classList.contains('active')) {
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
     * Used after a cross-tab storage change so the whole page reflects reality.
     */
    function refreshFavCompareUI() {
        updateBadges();

        document.querySelectorAll('.favorite-btn[data-id]').forEach(btn => {
            btn.classList.toggle('active', favorites.includes(btn.getAttribute('data-id')));
        });
        document.querySelectorAll('.compare-btn[data-id]').forEach(btn => {
            btn.classList.toggle('active', compareList.includes(btn.getAttribute('data-id')));
        });

        if (currentProduct) {
            document.getElementById('detailFavoriteBtn')
                ?.classList.toggle('active', favorites.includes(currentProduct.id));
            document.getElementById('detailCompareBtn')
                ?.classList.toggle('active', compareList.includes(currentProduct.id));
        }

        updateCompareDrawer();
    }

    /**
     * Keep favorites/compare in sync across browser tabs via the storage event.
     * (Fires only in OTHER tabs than the one that made the change.)
     */
    function setupStorageSync() {
        window.addEventListener('storage', (e) => {
            if (e.key === 'gunpla-favorites') {
                try { favorites = JSON.parse(e.newValue) || []; } catch (err) { favorites = []; }
                refreshFavCompareUI();
                if (document.getElementById('favoritesNav')?.classList.contains('active')) {
                    showFavoritesView();
                }
            } else if (e.key === 'gunpla-compare') {
                try { compareList = JSON.parse(e.newValue) || []; } catch (err) { compareList = []; }
                refreshFavCompareUI();
                if (document.getElementById('compareNav')?.classList.contains('active')) {
                    showCompareView();
                }
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

        if (compareList.length > 0) {
            drawer.classList.add('active');

            itemsContainer.innerHTML = compareList.map(id => {
                const product = products.find(p => p.id === id);
                if (!product) return '';

                return `
                    <div class="compare-item" data-id="${id}">
                        <div class="compare-item-image">
                            <img src="${product.thumbnail}" alt="${I18n.getName(product.name)}" 
                                 onerror="this.src='images/placeholder.png'">
                        </div>
                        <span class="compare-item-name">${I18n.getName(product.name)}</span>
                    </div>
                `;
            }).join('');
        } else {
            drawer.classList.remove('active');
        }
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
        const tax = (typeof Filter !== 'undefined' && Filter.getTaxonomy) ? Filter.getTaxonomy() : null;
        const fd = p => p.filterData || {};

        // Resolve a localized label for a taxonomy category value
        const taxLabel = (catId, value) => {
            if (value === undefined || value === null || value === '') return '-';
            const cat = tax?.categories?.find(c => c.id === catId);
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

        // Header row: empty corner + one column per product
        let html = '<thead><tr><th class="corner"></th>';
        compProducts.forEach(p => {
            html += `
                <td class="product-header">
                    <button class="compare-remove" data-id="${p.id}" title="${L('비교함에서 제거', 'Remove from compare')}" aria-label="Remove">×</button>
                    <a href="detail.html?id=${p.id}" class="compare-product-link">
                        <img src="${getThumbnailUrl(p)}" alt="${I18n.getName(p.name)}"
                             onerror="this.src='images/placeholder.png'">
                        <span class="product-name">${I18n.getName(p.name)}</span>
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

                    html += `<td class="${cellClass}"><span class="cell-value">${spec.get(p)}</span>${barHtml}</td>`;
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
                <img src="${product.thumbnail}" alt="${I18n.getName(product.name)}"
                     onerror="this.src='images/placeholder.png'">
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
     * Load product detail page
     */
    async function loadProductDetail(productId) {
        try {
            // Try to load detailed data
            let product;
            try {
                const response = await fetch(`data/gunpla-details/${productId}.json`);
                product = await response.json();
            } catch {
                // Fallback to index data
                const indexResponse = await fetch('data/gunpla-index.json');
                const indexData = await indexResponse.json();
                product = indexData.products.find(p => p.id === productId);
            }

            if (!product) {
                console.error('Product not found:', productId);
                return;
            }

            // Store for language change re-rendering
            currentProduct = product;
            renderProductDetail(product);

        } catch (error) {
            console.error('Failed to load product detail:', error);
        }
    }

    /**
     * Render product detail page
     */
    function renderProductDetail(product) {
        // Update page title
        document.title = `${I18n.getName(product.name)} | ${I18n.t('site.title')}`;

        // Breadcrumb
        document.getElementById('breadcrumbGrade').textContent = product.grade;
        document.getElementById('breadcrumbCurrent').textContent = I18n.getName(product.name);

        // Main image - use same logic as main page for consistency
        const mainImage = document.getElementById('mainImage');
        mainImage.src = product.images?.boxart || getThumbnailUrl(product);
        mainImage.alt = I18n.getName(product.name);
        mainImage.onerror = function () { this.src = 'images/placeholder.png'; };

        // Badges
        const badges = document.getElementById('detailBadges');
        badges.innerHTML = `<span class="product-card-grade ${product.grade}">${product.grade}</span>`;
        if (product.isVerKa) badges.innerHTML += '<span class="product-badge limited">Ver.Ka</span>';
        if (product.isRevive) badges.innerHTML += '<span class="product-badge new">Revive</span>';

        // Header info
        document.getElementById('detailName').textContent = I18n.getName(product.name);

        const taxonomy = Filter.getTaxonomy();
        const seriesOption = taxonomy?.categories?.find(c => c.id === 'series')?.options?.find(o => o.value === product.series);
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

        // Weapons & Accessories
        if (product.weapons) {
            const weaponsList = document.getElementById('weaponsList');
            if (weaponsList) {
                const weapons = I18n.getLang() === 'ko' ? product.weapons.ko : product.weapons.en;
                const accessories = product.accessories ? (I18n.getLang() === 'ko' ? product.accessories.ko : product.accessories.en) : [];
                const allItems = [...(weapons || []), ...(accessories || [])];
                weaponsList.innerHTML = allItems.map(w => `<span class="product-tag">${w}</span>`).join('') || '';
            }
        }

        // Recommended for
        if (product.recommendation?.perfectFor) {
            const list = document.getElementById('recommendedForList');
            if (list) {
                const items = I18n.getLang() === 'ko' ? product.recommendation.perfectFor.ko : product.recommendation.perfectFor.en;
                list.innerHTML = items?.map(item => `<li>• ${item}</li>`).join('') || '';
            }
        }

        // Building tips
        if (product.buildingTips) {
            const tipsList = document.getElementById('tipsList');
            if (tipsList) {
                const tips = I18n.getLang() === 'ko' ? product.buildingTips.ko : product.buildingTips.en;
                tipsList.innerHTML = tips?.map(tip => `<li>💡 ${tip}</li>`).join('') || '';
            }
        }

        // Setup tabs
        setupDetailTabs();

        // Actions
        setupDetailActions(product);
    }

    /**
     * Render specs grid
     */
    function renderSpecs(product) {
        const grid = document.getElementById('specsGrid');
        if (!grid) return;

        const specs = product.fullSpecs || product.filterData || {};
        const taxonomy = Filter.getTaxonomy();

        const specItems = [
            { key: 'partCount', label: I18n.t('product.partCount') },
            { key: 'runnerCount', label: I18n.t('product.runnerCount') },
            { key: 'difficulty', label: I18n.t('difficulty.beginner').replace('초보', '난이도').replace('Beginner', 'Difficulty') },
            { key: 'mobility', label: I18n.getLang() === 'ko' ? '가동성' : 'Mobility' },
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
            } else if (taxonomy) {
                const category = taxonomy.categories.find(c => c.id === key);
                const option = category?.options?.find(o => o.value === value);
                if (option) value = I18n.getName(option.label);
            }

            return `
                <div class="spec-item">
                    <span class="spec-label">${label}</span>
                    <span class="spec-value">${value}</span>
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

        // Color/Config variants
        if (variantsGrid && product.variants) {
            variantsGrid.innerHTML = product.variants.map(v => `
                <a href="detail.html?id=${v.id}" class="variant-card ${v.id === product.id ? 'current' : ''}" data-id="${v.id}">
                    <img src="https://gunpla.fyi/images/boxarts/${Math.floor(Math.random() * 500)}" 
                         alt="${I18n.getName(v.name)}" class="variant-image"
                         onerror="this.src='images/placeholder.png'">
                    <div class="variant-info">
                        <span class="variant-type">${v.variantType}</span>
                        <span class="variant-name">${I18n.getName(v.name)}</span>
                    </div>
                </a>
            `).join('');
        }

        // Related grades (different grade same MS)
        if (relatedGrades && product.relatedGrades) {
            relatedGrades.innerHTML = product.relatedGrades.map(r => `
                <a href="detail.html?id=${r.id}" class="related-grade-item" data-id="${r.id}">
                    <span class="grade-badge product-card-grade ${r.grade}">${r.grade}</span>
                    <span class="grade-name">${I18n.getName(r.name)}</span>
                </a>
            `).join('');
        }
    }

    /**
     * Setup detail page tabs
     */
    function setupDetailTabs() {
        const tabs = document.querySelectorAll('.tab-btn');
        const contents = document.querySelectorAll('.tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));

                tab.classList.add('active');
                const tabId = tab.getAttribute('data-tab');
                document.getElementById(`${tabId}Tab`)?.classList.add('active');
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

        // Reflect current state on every render (safe to run repeatedly)
        if (favBtn) favBtn.classList.toggle('active', favorites.includes(product.id));
        if (compBtn) compBtn.classList.toggle('active', compareList.includes(product.id));

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

        // Bandai manual link
        if (manualBtn) {
            let manualId = product.gunplaFyiId || product.manualId;

            // Try to extract ID from thumbnail URL if not available
            if (!manualId && product.thumbnail) {
                // Match patterns like /boxarts/196 or /boxarts/196.jpeg
                const match = product.thumbnail.match(/boxarts\/(\d+)/);
                if (match) manualId = match[1];
            }

            if (manualId) {
                // Direct manual link
                manualBtn.href = `https://manual.bandai-hobby.net/menus/detail/${manualId}`;
                manualBtn.style.display = 'flex';
            } else {
                // Fallback: search by product name on manual site
                const searchName = encodeURIComponent(I18n.getName(product.name) || product.modelNumber || '');
                if (searchName) {
                    manualBtn.href = `https://manual.bandai-hobby.net/?q=${searchName}`;
                    manualBtn.style.display = 'flex';
                    manualBtn.title = '설명서 검색 (정확한 링크 없음)';
                } else {
                    manualBtn.style.display = 'none';
                }
            }
        }
    }

    /**
     * Save favorites to localStorage
     */
    function saveFavorites() {
        localStorage.setItem('gunpla-favorites', JSON.stringify(favorites));
    }

    /**
     * Save compare list to localStorage
     */
    function saveCompareList() {
        localStorage.setItem('gunpla-compare', JSON.stringify(compareList));
    }

    /**
     * Load saved data from localStorage
     */
    function loadSavedData() {
        try {
            favorites = JSON.parse(localStorage.getItem('gunpla-favorites')) || [];
            compareList = JSON.parse(localStorage.getItem('gunpla-compare')) || [];
            updateBadges();
            updateCompareDrawer();
        } catch {
            favorites = [];
            compareList = [];
        }
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Filter change
        document.addEventListener('filterChange', applyFiltersAndRender);

        // Language change - re-render all products with new language
        document.addEventListener('langChange', () => {
            if (document.body.classList.contains('detail-page')) {
                if (currentProduct) renderProductDetail(currentProduct);
            } else {
                const tableSection = document.getElementById('compareTableSection');
                if (tableSection && tableSection.style.display !== 'none') {
                    // Compare view is active — re-render the spec table in the new language
                    showCompareView();
                } else {
                    displayedCount = 0; // Reset to force full re-render
                    renderProducts();
                    updateRecommendationPanel(Filter.getActiveFilters());
                }
            }
            updateCompareDrawer(); // Also update compare drawer names
        });

        // Language toggle
        document.querySelectorAll('.lang-toggle, .mobile-lang-toggle').forEach(btn => {
            btn.addEventListener('click', I18n.toggleLang);
        });

        // Mobile menu
        const mobileMenuBtn = document.getElementById('mobileMenuBtn');
        const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');
        if (mobileMenuBtn && mobileMenuOverlay) {
            mobileMenuBtn.addEventListener('click', () => {
                mobileMenuBtn.classList.toggle('active');
                mobileMenuOverlay.classList.toggle('active');
            });
        }

        // Mobile filter
        const mobileFilterBtn = document.getElementById('mobileFilterBtn');
        const filterSidebar = document.getElementById('filterSidebar');
        if (mobileFilterBtn && filterSidebar) {
            mobileFilterBtn.addEventListener('click', () => {
                filterSidebar.classList.toggle('active');
            });
        }

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
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentView = btn.getAttribute('data-view');
                document.getElementById('productGrid')?.classList.toggle('list-view', currentView === 'list');
            });
        });

        // Load more
        const loadMoreBtn = document.getElementById('loadMoreBtn');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', renderProducts);
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
        const compareDrawerClose = document.getElementById('compareDrawerClose');
        if (compareDrawerClose) {
            compareDrawerClose.addEventListener('click', () => {
                document.getElementById('compareDrawer')?.classList.remove('active');
            });
        }

        const compareClearBtn = document.getElementById('compareClearBtn');
        if (compareClearBtn) {
            compareClearBtn.addEventListener('click', () => {
                compareList = [];
                saveCompareList();
                updateBadges();
                updateCompareDrawer();
                document.querySelectorAll('.compare-btn.active').forEach(b => b.classList.remove('active'));
                // Reflect immediately if the Compare tab is open
                if (document.getElementById('compareNav')?.classList.contains('active')) {
                    showCompareView();
                }
            });
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

        // Navigation tabs - Favorites and Compare
        const favoritesNav = document.getElementById('favoritesNav');
        if (favoritesNav) {
            favoritesNav.addEventListener('click', (e) => {
                e.preventDefault();
                showFavoritesView();
            });
        }

        const compareNav = document.getElementById('compareNav');
        if (compareNav) {
            compareNav.addEventListener('click', (e) => {
                e.preventDefault();
                showCompareView();
            });
        }

        // Home navigation
        document.querySelectorAll('.nav-item[data-page="home"]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                showHomeView();
            });
        });
    }

    /**
     * Show favorites view
     */
    function showFavoritesView() {
        // Update nav active state
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.getElementById('favoritesNav')?.classList.add('active');

        // Restore normal grid layout (in case we came from compare view)
        exitCompareLayout();

        // Filter to show only favorites
        const favProducts = products.filter(p => favorites.includes(p.id));
        filteredProducts = favProducts;
        displayedCount = 0;

        // Hide recommendation panel
        showRecommendationPanel(false);

        // Update result count
        const countEl = document.getElementById('resultCount');
        if (countEl) countEl.textContent = favProducts.length;

        // Render
        const grid = document.getElementById('productGrid');
        const noResults = document.getElementById('noResults');
        const loadMoreContainer = document.getElementById('loadMoreContainer');

        if (favProducts.length === 0) {
            grid.innerHTML = '';
            noResults.style.display = 'flex';
            noResults.querySelector('h3').textContent = I18n.getLang() === 'ko' ? '즐겨찾기가 없습니다' : 'No favorites yet';
            loadMoreContainer.style.display = 'none';
        } else {
            noResults.style.display = 'none';
            renderProducts();
        }
    }

    /**
     * Show compare view
     */
    function showCompareView() {
        // Update nav active state
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.getElementById('compareNav')?.classList.add('active');

        // Filter to show only compare items
        const compProducts = products.filter(p => compareList.includes(p.id));

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
                noResults.style.display = 'flex';
                noResults.querySelector('h3').textContent = I18n.getLang() === 'ko' ? '비교함이 비어있습니다' : 'Compare list is empty';
            }
            if (tableSection) tableSection.style.display = 'none';
        } else {
            if (noResults) noResults.style.display = 'none';
            renderCompareTable(compProducts);
        }
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
        // Update nav active state
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelector('.nav-item[data-page="home"]')?.classList.add('active');

        // Reset no results text
        const noResults = document.getElementById('noResults');
        if (noResults) {
            noResults.querySelector('h3').textContent = I18n.getLang() === 'ko' ? '검색 결과가 없습니다' : 'No results found';
        }

        // Restore normal grid layout (in case we came from compare view)
        exitCompareLayout();

        // Re-apply filters and render
        applyFiltersAndRender();
    }

    // Public API
    return {
        init,
        loadProductDetail,
        toggleFavorite,
        toggleCompare,
        setupDetailTabs,
        setFavorites: (list) => { favorites = list; },
        setCompareList: (list) => { compareList = list; },
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
    // Only init on main page
    if (!document.body.classList.contains('detail-page')) {
        GunplaApp.init();
    } else {
        // Detail page - init modules and setup language toggle
        I18n.init().then(async () => {
            I18n.initTheme(); // Apply saved theme
            Filter.init();

            // Load saved favorites and compare data
            const savedFavorites = localStorage.getItem('gunpla-favorites');
            const savedCompare = localStorage.getItem('gunpla-compare');
            if (savedFavorites) {
                try {
                    GunplaApp.setFavorites(JSON.parse(savedFavorites));
                } catch (e) {
                    GunplaApp.setFavorites([]);
                }
            }
            if (savedCompare) {
                try {
                    GunplaApp.setCompareList(JSON.parse(savedCompare));
                } catch (e) {
                    GunplaApp.setCompareList([]);
                }
            }

            // Update nav badges with loaded data
            GunplaApp.updateBadges();

            // Load the product index so the recent-viewed strip can render thumbnails
            await GunplaApp.loadProducts();

            // Load product from URL parameter
            const urlParams = new URLSearchParams(window.location.search);
            const productId = urlParams.get('id');
            if (productId) {
                GunplaApp.loadProductDetail(productId);
                // Track as recently viewed (also renders the strip)
                GunplaApp.addToRecent(productId);
            } else {
                GunplaApp.renderRecentProducts();
            }

            // Wire the "clear recent" button on the detail page
            const clearRecentBtn = document.getElementById('clearRecentBtn');
            if (clearRecentBtn) {
                clearRecentBtn.addEventListener('click', GunplaApp.clearRecentProducts);
            }

            // Wire the inconspicuous footer reset buttons on the detail page
            GunplaApp.setupResetButtons();

            // Cross-tab favorites/compare synchronization
            GunplaApp.setupStorageSync();

            // Setup tabs immediately (don't depend on data load)
            GunplaApp.setupDetailTabs();

            // Setup language toggle for detail page
            document.querySelectorAll('.lang-toggle, .mobile-lang-toggle').forEach(btn => {
                btn.addEventListener('click', I18n.toggleLang);
            });

            // Mobile menu toggle for detail page
            const mobileMenuBtn = document.getElementById('mobileMenuBtn');
            const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');
            if (mobileMenuBtn && mobileMenuOverlay) {
                mobileMenuBtn.addEventListener('click', () => {
                    mobileMenuBtn.classList.toggle('active');
                    mobileMenuOverlay.classList.toggle('active');
                });
            }
        });
    }
});