/**
 * Gunpla Guide - Filter Module
 * Handles product filtering, search, and URL state
 */

const Filter = (function () {
    let taxonomy = null;
    let activeFilters = {};
    let searchQuery = '';

    // Korean Choseong (초성) constants
    const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
    const HANGUL_START = 0xAC00;
    const HANGUL_END = 0xD7A3;
    const CHOSEONG_BASE = 588; // 21 * 28

    /**
     * Check if character is a Korean consonant (초성)
     */
    function isChoseong(char) {
        return CHOSEONG.includes(char);
    }

    /**
     * Extract choseong from a Korean syllable
     */
    function getChoseong(char) {
        const code = char.charCodeAt(0);
        if (code >= HANGUL_START && code <= HANGUL_END) {
            const index = Math.floor((code - HANGUL_START) / CHOSEONG_BASE);
            return CHOSEONG[index];
        }
        return char;
    }

    /**
     * Extract all choseong from a Korean string
     */
    function extractChoseong(str) {
        return str.split('').map(char => {
            const code = char.charCodeAt(0);
            if (code >= HANGUL_START && code <= HANGUL_END) {
                return getChoseong(char);
            }
            return char;
        }).join('');
    }

    /**
     * Check if query is a choseong-only string
     */
    function isChoseongQuery(query) {
        return query.split('').every(char => isChoseong(char) || char === ' ');
    }

    /**
     * Match choseong query against text
     */
    function matchChoseong(text, query) {
        const textChoseong = extractChoseong(text);
        return textChoseong.toLowerCase().includes(query.toLowerCase());
    }

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

    // Search History constants
    const SEARCH_HISTORY_KEY = 'gunpla-search-history';
    const MAX_HISTORY_ITEMS = 10;

    /**
     * Get search history from localStorage
     */
    function getSearchHistory() {
        try {
            const history = localStorage.getItem(SEARCH_HISTORY_KEY);
            return history ? JSON.parse(history) : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * Save search query to history
     */
    function saveToHistory(query) {
        if (!query || query.length < 2) return;

        let history = getSearchHistory();

        // Remove if already exists (to move to top)
        history = history.filter(h => h.toLowerCase() !== query.toLowerCase());

        // Add to beginning
        history.unshift(query);

        // Limit to max items
        history = history.slice(0, MAX_HISTORY_ITEMS);

        try {
            localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
        } catch (e) {
            console.warn('Failed to save search history:', e);
        }
    }

    /**
     * Remove item from search history
     */
    function removeFromHistory(query) {
        let history = getSearchHistory();
        history = history.filter(h => h !== query);
        try {
            localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
        } catch (e) {
            console.warn('Failed to update search history:', e);
        }
    }

    /**
     * Clear all search history
     */
    function clearSearchHistory() {
        try {
            localStorage.removeItem(SEARCH_HISTORY_KEY);
        } catch (e) {
            console.warn('Failed to clear search history:', e);
        }
    }

    /**
     * Set search query
     */
    function setSearchQuery(query) {
        searchQuery = query.trim().toLowerCase();

        // Save to history if meaningful query
        if (searchQuery.length >= 2) {
            saveToHistory(query.trim());
        }

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
            const searchLower = searchQuery.toLowerCase();
            const searchFields = [
                I18n.getName(product.name),
                product.id,
                product.modelNumber || '',
                product.grade,
                product.series
            ];

            // Check regular text match
            const regularMatch = searchFields.some(field =>
                (field || '').toLowerCase().includes(searchLower)
            );

            // Check choseong match for Korean names
            const nameKo = product.name?.ko || '';
            const choseongMatch = isChoseongQuery(searchQuery) && matchChoseong(nameKo, searchQuery);

            if (!regularMatch && !choseongMatch) return false;
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

            // Accordion toggle - close others when opening new one
            const header = clone.querySelector('.filter-category-header');
            header.addEventListener('click', () => {
                const isCurrentlyActive = categoryEl.classList.contains('active');

                // Close all other categories
                document.querySelectorAll('.filter-category.active').forEach(cat => {
                    cat.classList.remove('active');
                });

                // Toggle current category (if it was closed, open it)
                if (!isCurrentlyActive) {
                    categoryEl.classList.add('active');
                }
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
     * Show autocomplete suggestions
     */
    function showAutocompleteSuggestions(query, container) {
        const products = window.GunplaApp?.getProducts() || [];
        const suggestions = [];
        const lowerQuery = query.toLowerCase();
        const maxSuggestions = 8;
        const isChoseongSearch = isChoseongQuery(query);

        // Search in product names
        products.forEach(p => {
            const nameKo = p.name?.ko || '';
            const nameEn = p.name?.en || '';
            const modelNumber = p.modelNumber || '';

            // Regular text search OR choseong search
            if (nameKo.toLowerCase().includes(lowerQuery)) {
                suggestions.push({ type: 'product', text: nameKo, value: nameKo, match: lowerQuery });
            } else if (isChoseongSearch && matchChoseong(nameKo, query)) {
                // Choseong match (e.g., 'ㄱㄷ' matches '건담')
                suggestions.push({ type: 'product', text: nameKo, value: nameKo, match: query, isChoseong: true });
            } else if (nameEn.toLowerCase().includes(lowerQuery)) {
                suggestions.push({ type: 'product', text: nameEn, value: nameEn, match: lowerQuery });
            }

            // Model number search
            if (modelNumber.toLowerCase().includes(lowerQuery)) {
                suggestions.push({ type: 'model', text: `${modelNumber} - ${I18n.getName(p.name)}`, value: modelNumber, match: lowerQuery });
            }
        });

        // Search in series (from taxonomy)
        const seriesCategory = taxonomy?.categories?.find(c => c.id === 'series');
        if (seriesCategory) {
            seriesCategory.options.forEach(opt => {
                const labelKo = opt.label?.ko || '';
                const labelEn = opt.label?.en || '';
                if (labelKo.toLowerCase().includes(lowerQuery) || labelEn.toLowerCase().includes(lowerQuery)) {
                    suggestions.push({ type: 'series', text: I18n.getName(opt.label), value: I18n.getName(opt.label), match: lowerQuery });
                }
            });
        }

        // Note: deduplication moved to finalSuggestions below after adding history

        // Add search history items (at top or when query is short)
        const history = getSearchHistory();
        if (history.length > 0 && lowerQuery.length <= 1) {
            // Show recent history when query is short
            history.slice(0, 5).forEach(h => {
                suggestions.unshift({ type: 'history', text: h, value: h, match: '' });
            });
        } else if (history.length > 0) {
            // Add matching history items
            history.forEach(h => {
                if (h.toLowerCase().includes(lowerQuery) && !suggestions.find(s => s.value === h)) {
                    suggestions.unshift({ type: 'history', text: h, value: h, match: lowerQuery });
                }
            });
        }

        if (suggestions.length === 0) {
            container.classList.remove('active');
            return;
        }

        // Rebuild unique list including history
        const finalSuggestions = [];
        const seen = new Set();
        for (const s of suggestions) {
            if (!seen.has(s.text.toLowerCase()) && finalSuggestions.length < maxSuggestions) {
                seen.add(s.text.toLowerCase());
                finalSuggestions.push(s);
            }
        }

        // Render suggestions
        container.innerHTML = finalSuggestions.map(s => `
            <div class="autocomplete-item ${s.type === 'history' ? 'history-item' : ''}" data-value="${s.value}" data-type="${s.type}">
                <span class="autocomplete-item-type ${s.type}">${s.type === 'product' ? '제품' : s.type === 'series' ? '시리즈' : s.type === 'model' ? '형식' : '🕒'}</span>
                <span class="autocomplete-item-text">${s.match ? highlightMatch(s.text, s.match) : s.text}</span>
                ${s.type === 'history' ? '<button class="history-delete-btn" data-query="' + s.value + '">×</button>' : ''}
            </div>
        `).join('');

        // Add click handlers for suggestions
        container.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Don't trigger if clicking delete button
                if (e.target.classList.contains('history-delete-btn')) return;

                const value = item.getAttribute('data-value');
                const input = document.getElementById('searchInput');
                if (input) {
                    input.value = value;
                    setSearchQuery(value);
                }
                container.classList.remove('active');
            });
        });

        // Add delete handlers for history items
        container.querySelectorAll('.history-delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const query = btn.getAttribute('data-query');
                removeFromHistory(query);
                // Refresh autocomplete
                const input = document.getElementById('searchInput');
                if (input) {
                    showAutocompleteSuggestions(input.value, container);
                }
            });
        });

        container.classList.add('active');
    }

    /**
     * Highlight matching text
     */
    function highlightMatch(text, match) {
        const index = text.toLowerCase().indexOf(match.toLowerCase());
        if (index === -1) return text;
        return text.slice(0, index) + '<mark>' + text.slice(index, index + match.length) + '</mark>' + text.slice(index + match.length);
    }

    /**
     * Update selected autocomplete item
     */
    function updateSelectedItem(items, index) {
        items.forEach((item, i) => {
            item.classList.toggle('selected', i === index);
        });
        if (items[index]) {
            items[index].scrollIntoView({ block: 'nearest' });
        }
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Search input with autocomplete
        const searchInput = document.getElementById('searchInput');
        const autocomplete = document.getElementById('searchAutocomplete');
        let selectedIndex = -1;

        if (searchInput) {
            let debounceTimer;

            // Input event - show autocomplete and filter
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.trim();

                // Show autocomplete suggestions
                if (query.length >= 1 && autocomplete) {
                    showAutocompleteSuggestions(query, autocomplete);
                    selectedIndex = -1;
                } else if (autocomplete) {
                    autocomplete.classList.remove('active');
                }

                // Debounced search
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    setSearchQuery(query);
                }, 300);
            });

            // Keyboard navigation
            searchInput.addEventListener('keydown', (e) => {
                if (!autocomplete || !autocomplete.classList.contains('active')) return;

                const items = autocomplete.querySelectorAll('.autocomplete-item');
                if (items.length === 0) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                    updateSelectedItem(items, selectedIndex);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selectedIndex = Math.max(selectedIndex - 1, 0);
                    updateSelectedItem(items, selectedIndex);
                } else if (e.key === 'Enter' && selectedIndex >= 0) {
                    e.preventDefault();
                    items[selectedIndex].click();
                } else if (e.key === 'Escape') {
                    autocomplete.classList.remove('active');
                    selectedIndex = -1;
                }
            });

            // Hide on blur (with delay for click)
            searchInput.addEventListener('blur', () => {
                setTimeout(() => {
                    if (autocomplete) autocomplete.classList.remove('active');
                }, 200);
            });

            // Show on focus if has value
            searchInput.addEventListener('focus', (e) => {
                const query = e.target.value.trim();
                if (query.length >= 1 && autocomplete) {
                    showAutocompleteSuggestions(query, autocomplete);
                }
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