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

        // Action buttons
        const favoriteBtn = card.querySelector('.favorite-btn');
        if (favorites.includes(product.id)) {
            favoriteBtn.classList.add('active');
        }
        favoriteBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFavorite(product.id);
            favoriteBtn.classList.toggle('active');
        });

        const compareBtn = card.querySelector('.compare-btn');
        if (compareList.includes(product.id)) {
            compareBtn.classList.add('active');
        }
        compareBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCompare(product.id);
            compareBtn.classList.toggle('active');
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
        if (index > -1) {
            favorites.splice(index, 1);
        } else {
            favorites.push(productId);
        }
        saveFavorites();
        updateBadges();
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
        updateBadges();
        updateCompareDrawer();
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

        if (favBtn) {
            if (favorites.includes(product.id)) favBtn.classList.add('active');
            favBtn.addEventListener('click', () => {
                toggleFavorite(product.id);
                favBtn.classList.toggle('active');
            });
        }

        if (compBtn) {
            if (compareList.includes(product.id)) compBtn.classList.add('active');
            compBtn.addEventListener('click', () => {
                toggleCompare(product.id);
                compBtn.classList.toggle('active');
            });
        }

        // Bandai manual link
        if (manualBtn) {
            let productId = product.gunplaFyiId;

            // Try to extract ID from thumbnail URL if gunplaFyiId not available
            if (!productId && product.thumbnail) {
                const match = product.thumbnail.match(/boxarts\/(\d+)/);
                if (match) productId = match[1];
            }

            if (productId) {
                manualBtn.href = `https://manual.bandai-hobby.net/menus/detail/${productId}`;
                manualBtn.style.display = 'flex';
            } else {
                manualBtn.style.display = 'none';
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
                displayedCount = 0; // Reset to force full re-render
                renderProducts();
                updateRecommendationPanel(Filter.getActiveFilters());
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
            });
        }

        // Clear recent products button
        const clearRecentBtn = document.getElementById('clearRecentBtn');
        if (clearRecentBtn) {
            clearRecentBtn.addEventListener('click', clearRecentProducts);
        }

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
        filteredProducts = compProducts;
        displayedCount = 0;

        // Hide recommendation panel
        showRecommendationPanel(false);

        // Update result count
        const countEl = document.getElementById('resultCount');
        if (countEl) countEl.textContent = compProducts.length;

        // Render
        const grid = document.getElementById('productGrid');
        const noResults = document.getElementById('noResults');
        const loadMoreContainer = document.getElementById('loadMoreContainer');

        if (compProducts.length === 0) {
            grid.innerHTML = '';
            noResults.style.display = 'flex';
            noResults.querySelector('h3').textContent = I18n.getLang() === 'ko' ? '비교함이 비어있습니다' : 'Compare list is empty';
            loadMoreContainer.style.display = 'none';
        } else {
            noResults.style.display = 'none';
            renderProducts();
        }
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
        addToRecent
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
        I18n.init().then(() => {
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

            // Load product from URL parameter
            const urlParams = new URLSearchParams(window.location.search);
            const productId = urlParams.get('id');
            if (productId) {
                GunplaApp.loadProductDetail(productId);
                // Track as recently viewed
                GunplaApp.addToRecent(productId);
            }

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