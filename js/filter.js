/**
 * Gunpla Guide - Filter Module
 * Handles product filtering, search, and URL state
 */

const Filter = (function () {
    let taxonomy = null;
    let activeFilters = {};
    let searchQuery = '';

    /**
     * Initialize filter module
     */
    async function init() {
        try {
            // Load taxonomy
            const response = await fetch('data/taxonomy.json');
            taxonomy = await response.json();

            // Restore filters from URL
            restoreFromURL();

            // Build filter UI
            buildFilterUI();

            // Setup event listeners
            setupEventListeners();

        } catch (error) {
            console.error('Failed to initialize filters:', error);
        }
    }

    /**
     * Get taxonomy data
     */
    function getTaxonomy() {
        return taxonomy;
    }

    /**
     * Get active filters
     */
    function getActiveFilters() {
        return { ...activeFilters };
    }

    /**
     * Get search query
     */
    function getSearchQuery() {
        return searchQuery;
    }

    /**
     * Set search query
     */
    function setSearchQuery(query) {
        searchQuery = query.trim().toLowerCase();
        updateURL();
        dispatchFilterChange();
    }

    /**
     * Set filter value
     */
    function setFilter(categoryId, value, isActive) {
        if (!activeFilters[categoryId]) {
            activeFilters[categoryId] = [];
        }

        if (isActive) {
            if (!activeFilters[categoryId].includes(value)) {
                activeFilters[categoryId].push(value);
            }
        } else {
            activeFilters[categoryId] = activeFilters[categoryId].filter(v => v !== value);
            if (activeFilters[categoryId].length === 0) {
                delete activeFilters[categoryId];
            }
        }

        updateURL();
        updateActiveFiltersUI();
        dispatchFilterChange();
    }

    /**
     * Toggle filter value
     */
    function toggleFilter(categoryId, value) {
        const isActive = activeFilters[categoryId]?.includes(value);
        setFilter(categoryId, value, !isActive);
    }

    /**
     * Set range filter
     */
    function setRangeFilter(categoryId, min, max) {
        activeFilters[categoryId] = { min, max };
        updateURL();
        updateActiveFiltersUI();
        dispatchFilterChange();
    }

    /**
     * Remove specific filter
     */
    function removeFilter(categoryId, value) {
        if (value !== undefined) {
            setFilter(categoryId, value, false);
        } else {
            delete activeFilters[categoryId];
            updateURL();
            updateActiveFiltersUI();
            dispatchFilterChange();
        }
    }

    /**
     * Clear all filters
     */
    function clearAllFilters() {
        activeFilters = {};
        searchQuery = '';

        // Clear UI
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';

        const mobileSearchInput = document.getElementById('mobileSearchInput');
        if (mobileSearchInput) mobileSearchInput.value = '';

        // Update filter UI
        document.querySelectorAll('.filter-option.selected').forEach(el => {
            el.classList.remove('selected');
        });

        document.querySelectorAll('.filter-category-count').forEach(el => {
            el.textContent = '';
        });

        updateURL();
        updateActiveFiltersUI();
        dispatchFilterChange();
    }

    /**
     * Check if a product matches current filters
     */
    function matchesFilters(product) {
        // Search query matching
        if (searchQuery) {
            const searchFields = [
                I18n.getName(product.name),
                product.id,
                product.modelNumber || '',
                product.grade,
                product.series
            ].map(s => (s || '').toLowerCase());

            const matches = searchFields.some(field => field.includes(searchQuery));
            if (!matches) return false;
        }

        // Filter matching
        for (const [categoryId, values] of Object.entries(activeFilters)) {
            const category = taxonomy?.categories?.find(c => c.id === categoryId);
            if (!category) continue;

            let productValue = product[categoryId] ?? product.filterData?.[categoryId];

            // Handle range filters
            if (category.type === 'range') {
                if (typeof values === 'object' && values.min !== undefined) {
                    if (productValue < values.min || productValue > values.max) {
                        return false;
                    }
                }
                continue;
            }

            // Handle boolean filters
            if (category.type === 'boolean') {
                const filterValue = values[0];
                if (filterValue !== undefined && productValue !== filterValue) {
                    return false;
                }
                continue;
            }

            // Handle single/multiple selection
            if (Array.isArray(values) && values.length > 0) {
                if (Array.isArray(productValue)) {
                    // Product has multiple values, check if any match
                    if (!productValue.some(v => values.includes(v))) {
                        return false;
                    }
                } else {
                    if (!values.includes(productValue)) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    /**
     * Build filter UI from taxonomy
     */
    function buildFilterUI() {
        const container = document.getElementById('filterAccordion');
        if (!container || !taxonomy) return;

        container.innerHTML = '';

        const template = document.getElementById('filterCategoryTemplate');
        if (!template) return;

        taxonomy.categories.forEach(category => {
            const clone = template.content.cloneNode(true);
            const categoryEl = clone.querySelector('.filter-category');

            categoryEl.setAttribute('data-category', category.id);

            const title = clone.querySelector('.filter-category-title');
            title.textContent = I18n.getName(category.label);

            const content = clone.querySelector('.filter-options');

            if (category.type === 'range') {
                // Range filter UI
                content.innerHTML = `
                    <div class="filter-range">
                        <div class="filter-range-inputs">
                            <input type="number" class="range-min" placeholder="${category.min}" min="${category.min}" max="${category.max}">
                            <span>~</span>
                            <input type="number" class="range-max" placeholder="${category.max}" min="${category.min}" max="${category.max}">
                        </div>
                        <input type="range" class="filter-range-slider" min="${category.min}" max="${category.max}" step="${category.step || 1}">
                    </div>
                `;
            } else if (category.options) {
                // Options filter UI
                category.options.forEach(option => {
                    const optionEl = document.createElement('div');
                    optionEl.className = 'filter-option';
                    optionEl.setAttribute('data-value', option.value);
                    optionEl.innerHTML = `
                        <span class="filter-checkbox"></span>
                        <span class="filter-option-label">${I18n.getName(option.label)}</span>
                    `;

                    optionEl.addEventListener('click', () => {
                        toggleFilter(category.id, option.value);
                        optionEl.classList.toggle('selected');
                        updateCategoryCount(category.id);
                    });

                    content.appendChild(optionEl);
                });
            }

            // Accordion toggle
            const header = clone.querySelector('.filter-category-header');
            header.addEventListener('click', () => {
                categoryEl.classList.toggle('active');
            });

            container.appendChild(clone);
        });
    }

    /**
     * Update category filter count badge
     */
    function updateCategoryCount(categoryId) {
        const category = document.querySelector(`[data-category="${categoryId}"]`);
        if (!category) return;

        const count = activeFilters[categoryId]?.length || 0;
        const badge = category.querySelector('.filter-category-count');
        if (badge) {
            badge.textContent = count > 0 ? count : '';
        }
    }

    /**
     * Update active filters display
     */
    function updateActiveFiltersUI() {
        const wrapper = document.getElementById('activeFiltersWrapper');
        const container = document.getElementById('activeFilters');
        const countEl = document.getElementById('activeFiltersCount');

        if (!container) return;

        container.innerHTML = '';

        // Count total active filters
        let totalCount = 0;
        for (const values of Object.values(activeFilters)) {
            if (Array.isArray(values)) {
                totalCount += values.length;
            } else {
                totalCount += 1;
            }
        }

        // Show/hide wrapper based on count
        if (wrapper) {
            wrapper.style.display = totalCount > 0 ? 'block' : 'none';
        }

        // Update count
        if (countEl) {
            countEl.textContent = totalCount;
        }

        for (const [categoryId, values] of Object.entries(activeFilters)) {
            const category = taxonomy?.categories?.find(c => c.id === categoryId);
            if (!category) continue;

            if (Array.isArray(values)) {
                values.forEach(value => {
                    const option = category.options?.find(o => o.value === value);
                    const label = option ? I18n.getName(option.label) : value;

                    const tag = document.createElement('span');
                    tag.className = 'filter-tag';
                    tag.innerHTML = `
                        ${label}
                        <button class="filter-tag-remove" data-category="${categoryId}" data-value="${value}">×</button>
                    `;
                    container.appendChild(tag);
                });
            }
        }

        // Add remove button listeners
        container.querySelectorAll('.filter-tag-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const catId = btn.getAttribute('data-category');
                const val = btn.getAttribute('data-value');
                removeFilter(catId, val);

                // Update checkbox UI
                const optionEl = document.querySelector(`[data-category="${catId}"] [data-value="${val}"]`);
                if (optionEl) optionEl.classList.remove('selected');
                updateCategoryCount(catId);
            });
        });
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Search input
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            let debounceTimer;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    setSearchQuery(e.target.value);
                }, 300);
            });
        }

        // Mobile search
        const mobileSearchInput = document.getElementById('mobileSearchInput');
        if (mobileSearchInput) {
            let debounceTimer;
            mobileSearchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    setSearchQuery(e.target.value);
                }, 300);
            });
        }

        // Reset button
        const resetBtn = document.getElementById('filterResetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', clearAllFilters);
        }

        // Active filters summary toggle
        const activeFiltersSummary = document.getElementById('activeFiltersSummary');
        if (activeFiltersSummary) {
            activeFiltersSummary.addEventListener('click', () => {
                const wrapper = document.getElementById('activeFiltersWrapper');
                if (wrapper) {
                    wrapper.classList.toggle('expanded');
                }
            });
        }

        // Language change - rebuild filter UI
        document.addEventListener('langChange', () => {
            buildFilterUI();
            restoreFilterUIState();
        });
    }

    /**
     * Restore filter UI state after rebuild
     */
    function restoreFilterUIState() {
        for (const [categoryId, values] of Object.entries(activeFilters)) {
            if (Array.isArray(values)) {
                values.forEach(value => {
                    const optionEl = document.querySelector(`[data-category="${categoryId}"] [data-value="${value}"]`);
                    if (optionEl) optionEl.classList.add('selected');
                });
            }
            updateCategoryCount(categoryId);
        }
    }

    /**
     * Save filters to URL
     */
    function updateURL() {
        const params = new URLSearchParams();

        if (searchQuery) {
            params.set('q', searchQuery);
        }

        for (const [key, values] of Object.entries(activeFilters)) {
            if (Array.isArray(values) && values.length > 0) {
                params.set(key, values.join(','));
            } else if (typeof values === 'object' && values.min !== undefined) {
                params.set(key, `${values.min}-${values.max}`);
            }
        }

        const newURL = params.toString()
            ? `${window.location.pathname}?${params.toString()}`
            : window.location.pathname;

        window.history.replaceState({}, '', newURL);
    }

    /**
     * Restore filters from URL
     */
    function restoreFromURL() {
        const params = new URLSearchParams(window.location.search);

        if (params.has('q')) {
            searchQuery = params.get('q');
            const searchInput = document.getElementById('searchInput');
            if (searchInput) searchInput.value = searchQuery;
        }

        params.forEach((value, key) => {
            if (key === 'q') return;

            const category = taxonomy?.categories?.find(c => c.id === key);
            if (!category) return;

            if (category.type === 'range' && value.includes('-')) {
                const [min, max] = value.split('-').map(Number);
                activeFilters[key] = { min, max };
            } else {
                activeFilters[key] = value.split(',');
            }
        });
    }

    /**
     * Dispatch filter change event
     */
    function dispatchFilterChange() {
        document.dispatchEvent(new CustomEvent('filterChange', {
            detail: { filters: activeFilters, query: searchQuery }
        }));
    }

    /**
     * Get active filter count
     */
    function getActiveFilterCount() {
        let count = 0;
        for (const values of Object.values(activeFilters)) {
            if (Array.isArray(values)) {
                count += values.length;
            } else {
                count += 1;
            }
        }
        return count;
    }

    // Public API
    return {
        init,
        getTaxonomy,
        getActiveFilters,
        getSearchQuery,
        setSearchQuery,
        setFilter,
        toggleFilter,
        setRangeFilter,
        removeFilter,
        clearAllFilters,
        matchesFilters,
        getActiveFilterCount
    };
})();

// Export
window.Filter = Filter;
