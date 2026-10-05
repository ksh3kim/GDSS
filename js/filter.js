/**
 * Gunpla Guide - Filter Module
 * Handles product filtering, search, and URL state
 */

const Filter = (function () {
    let taxonomy = null;
    let categoryMap = null; // id -> category, for O(1) lookups on hot paths
    let activeFilters = {};
    let searchQuery = '';
    let searchDebounce = null; // pending debounced search from typing

    // Korean Choseong (초성) constants
    const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
    const HANGUL_START = 0xAC00;
    const HANGUL_END = 0xD7A3;
    const CHOSEONG_BASE = 588; // 21 * 28

    /**
     * Escape HTML special characters before inserting user/URL data via innerHTML
     */
    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

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
            if (!response.ok) throw new Error(`Failed to load taxonomy (${response.status})`);
            taxonomy = await response.json();

            // Index categories by id for O(1) lookups (avoids repeated linear
            // scans of taxonomy.categories on hot paths like matchesFilters)
            categoryMap = new Map();
            (taxonomy.categories || []).forEach(c => categoryMap.set(c.id, c));

            // Restore filters from URL
            restoreFromURL();

            // Build filter UI
            buildFilterUI();

            // Reflect URL-restored filters in the sidebar UI
            // (checkbox selection, category counts, active-filter chips, reset button)
            restoreFilterUIState();
            updateActiveFiltersUI();
            updateQuickResetVisibility();

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
     * Get a taxonomy category by id (O(1) via the prebuilt map)
     */
    function getCategory(id) {
        if (categoryMap) return categoryMap.get(id);
        return taxonomy?.categories?.find(c => c.id === id);
    }

    /**
     * Get active filters
     */
    function getActiveFilters() {
        return { ...activeFilters };
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
     * Mirror the query into the other search box (desktop header ↔ mobile menu).
     * The box the user is typing in is left alone so its caret/spaces survive.
     */
    function syncSearchInputs(value, source) {
        ['searchInput', 'mobileSearchInput'].forEach(id => {
            const el = document.getElementById(id);
            if (el && el !== source && el !== document.activeElement) el.value = value;
        });
    }

    /**
     * Drop a debounced search that is still waiting, so it can't overwrite
     * a query the user has just committed (suggestion click / Enter / button)
     */
    function cancelPendingSearch() {
        clearTimeout(searchDebounce);
        searchDebounce = null;
    }

    /**
     * Set search query.
     * commit: true when the user explicitly submits (Enter, search button,
     * suggestion click) — only then is the query stored in search history,
     * so partial words typed along the way don't pile up there.
     */
    function setSearchQuery(query, { commit = false, source = null } = {}) {
        const raw = String(query || '').trim();
        searchQuery = raw.toLowerCase();

        if (commit && raw.length >= 2) {
            saveToHistory(raw);
        }

        syncSearchInputs(raw, source);
        updateURL();
        dispatchFilterChange();
    }

    /**
     * Set filter value
     */
    function setFilter(categoryId, value, isActive) {
        if (!Array.isArray(activeFilters[categoryId])) {
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
        cancelPendingSearch();
        activeFilters = {};
        searchQuery = '';

        // Clear UI
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = '';

        const mobileSearchInput = document.getElementById('mobileSearchInput');
        if (mobileSearchInput) mobileSearchInput.value = '';

        // Checkboxes, range inputs, counts
        restoreFilterUIState();

        updateURL();
        updateActiveFiltersUI();
        dispatchFilterChange();
    }

    /**
     * Update quick reset button visibility
     */
    function updateQuickResetVisibility() {
        const quickResetBtn = document.getElementById('quickResetBtn');
        if (!quickResetBtn) return;

        const hasFilters = Object.keys(activeFilters).length > 0 || searchQuery.length > 0;
        quickResetBtn.style.display = hasFilters ? 'inline-block' : 'none';
    }

    /**
     * Check if a product matches current filters
     */
    function matchesFilters(product) {
        // Search query matching
        if (searchQuery) {
            const searchLower = searchQuery.toLowerCase();
            // Include BOTH language names: autocomplete suggests ko/en names
            // regardless of the current UI language, so both must be searchable
            const searchFields = [
                product.name?.ko || '',
                product.name?.en || '',
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
            const category = getCategory(categoryId);
            if (!category) continue;

            let productValue = product[categoryId] ?? product.filterData?.[categoryId];

            // Handle range filters (a product without the value can't be in range)
            if (category.type === 'range') {
                if (values && typeof values === 'object' && values.min !== undefined) {
                    if (productValue == null || productValue < values.min || productValue > values.max) {
                        return false;
                    }
                }
                continue;
            }

            // Handle boolean filters (multi-select aware: selecting both
            // true and false must match every product, not just values[0])
            if (category.type === 'boolean') {
                if (Array.isArray(values) && values.length > 0 && !values.includes(productValue)) {
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
     * Read a range category's min/max inputs and apply (or clear) the filter.
     * Empty inputs fall back to the category bounds; both empty clears it.
     */
    function applyRangeInputs(category, minInput, maxInput) {
        const parse = v => (v === '' ? null : Number(v));
        let min = parse(minInput.value);
        let max = parse(maxInput.value);

        if ((min === null || isNaN(min)) && (max === null || isNaN(max))) {
            minInput.value = '';
            maxInput.value = '';
            if (activeFilters[category.id]) removeFilter(category.id);
            updateCategoryCount(category.id);
            return;
        }

        const clamp = n => Math.min(category.max, Math.max(category.min, n));
        const hasMin = min !== null && !isNaN(min);
        const hasMax = max !== null && !isNaN(max);
        min = hasMin ? clamp(min) : category.min;
        max = hasMax ? clamp(max) : category.max;
        if (min > max) [min, max] = [max, min];

        // Echo clamped/swapped values into the boxes the user filled; an empty
        // box stays empty (its placeholder already shows the open bound)
        if (hasMin) minInput.value = min;
        if (hasMax) maxInput.value = max;

        setRangeFilter(category.id, min, max);
        updateCategoryCount(category.id);
    }

    /**
     * Build filter UI from taxonomy
     */
    function buildFilterUI() {
        const container = document.getElementById('filterAccordion');
        if (!container || !taxonomy) return;

        // Keep the open accordion open across rebuilds (language change)
        const openIds = Array.from(container.querySelectorAll('.filter-category.active'))
            .map(el => el.getAttribute('data-category'));

        container.innerHTML = '';

        const template = document.getElementById('filterCategoryTemplate');
        if (!template) return;

        taxonomy.categories.forEach(category => {
            const clone = template.content.cloneNode(true);
            const categoryEl = clone.querySelector('.filter-category');

            categoryEl.setAttribute('data-category', category.id);

            const categoryLabel = I18n.getName(category.label);
            const title = clone.querySelector('.filter-category-title');
            title.textContent = categoryLabel;

            const content = clone.querySelector('.filter-options');
            const contentId = `filter-content-${category.id}`;
            clone.querySelector('.filter-category-content').id = contentId;

            if (category.type === 'range') {
                // Range filter UI: min ~ max number inputs, applied on change
                content.innerHTML = `
                    <div class="filter-range">
                        <div class="filter-range-inputs">
                            <input type="number" class="range-min" inputmode="numeric"
                                placeholder="${category.min}" min="${category.min}" max="${category.max}" step="${category.step || 1}"
                                aria-label="${escapeHtml(`${categoryLabel} ${I18n.t('filter.rangeMin')}`)}">
                            <span aria-hidden="true">~</span>
                            <input type="number" class="range-max" inputmode="numeric"
                                placeholder="${category.max}" min="${category.min}" max="${category.max}" step="${category.step || 1}"
                                aria-label="${escapeHtml(`${categoryLabel} ${I18n.t('filter.rangeMax')}`)}">
                        </div>
                    </div>
                `;
                const minInput = content.querySelector('.range-min');
                const maxInput = content.querySelector('.range-max');
                [minInput, maxInput].forEach(inp => {
                    inp.addEventListener('change', () => applyRangeInputs(category, minInput, maxInput));
                });
            } else if (category.options) {
                // Options filter UI (buttons so they are keyboard operable)
                category.options.forEach(option => {
                    const optionEl = document.createElement('button');
                    optionEl.type = 'button';
                    optionEl.className = 'filter-option';
                    optionEl.setAttribute('role', 'checkbox');
                    optionEl.setAttribute('aria-checked', 'false');
                    optionEl.setAttribute('data-value', option.value);
                    optionEl.innerHTML = `
                        <span class="filter-checkbox" aria-hidden="true"></span>
                        <span class="filter-option-label">${escapeHtml(I18n.getName(option.label))}</span>
                    `;

                    optionEl.addEventListener('click', () => {
                        toggleFilter(category.id, option.value);
                        syncCategoryUI(category.id);
                    });

                    content.appendChild(optionEl);
                });
            }

            // Accordion toggle - close others when opening new one
            const header = clone.querySelector('.filter-category-header');
            header.setAttribute('aria-controls', contentId);
            header.addEventListener('click', () => {
                const isCurrentlyActive = categoryEl.classList.contains('active');

                // Close all other categories
                document.querySelectorAll('.filter-category.active').forEach(cat => {
                    cat.classList.remove('active');
                    cat.querySelector('.filter-category-header')?.setAttribute('aria-expanded', 'false');
                });

                // Toggle current category (if it was closed, open it)
                if (!isCurrentlyActive) {
                    categoryEl.classList.add('active');
                    header.setAttribute('aria-expanded', 'true');
                }
            });

            if (openIds.includes(category.id)) {
                categoryEl.classList.add('active');
                header.setAttribute('aria-expanded', 'true');
            }

            container.appendChild(clone);
        });
    }

    /**
     * Update category filter count badge
     */
    function updateCategoryCount(categoryId) {
        const category = document.querySelector(`.filter-category[data-category="${categoryId}"]`);
        if (!category) return;

        const values = activeFilters[categoryId];
        const count = Array.isArray(values) ? values.length : (values ? 1 : 0);
        const badge = category.querySelector('.filter-category-count');
        if (badge) {
            badge.textContent = count > 0 ? count : '';
        }
    }

    /**
     * Make one category's controls (checkboxes or range inputs + count badge)
     * reflect activeFilters
     */
    function syncCategoryUI(categoryId) {
        const categoryEl = document.querySelector(`.filter-category[data-category="${categoryId}"]`);
        if (!categoryEl) return;

        const values = activeFilters[categoryId];

        categoryEl.querySelectorAll('.filter-option').forEach(optionEl => {
            const selected = Array.isArray(values) &&
                values.some(v => String(v) === optionEl.getAttribute('data-value'));
            optionEl.classList.toggle('selected', selected);
            optionEl.setAttribute('aria-checked', String(selected));
        });

        const minInput = categoryEl.querySelector('.range-min');
        const maxInput = categoryEl.querySelector('.range-max');
        if (minInput && maxInput) {
            // An open bound (equal to the category limit) is shown as empty
            const category = getCategory(categoryId);
            const isRange = values && !Array.isArray(values) && values.min !== undefined;
            minInput.value = isRange && values.min !== category?.min ? values.min : '';
            maxInput.value = isRange && values.max !== category?.max ? values.max : '';
        }

        updateCategoryCount(categoryId);
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

        const removeLabel = escapeHtml(I18n.t('filter.removeTag'));

        for (const [categoryId, values] of Object.entries(activeFilters)) {
            const category = getCategory(categoryId);
            if (!category) continue;

            if (Array.isArray(values)) {
                values.forEach(value => {
                    const option = category.options?.find(o => o.value === value);
                    const label = option ? I18n.getName(option.label) : value;

                    const tag = document.createElement('span');
                    tag.className = 'filter-tag';
                    // Escape: `value`/`label` can originate from the URL query string
                    tag.innerHTML = `
                        ${escapeHtml(label)}
                        <button class="filter-tag-remove" data-category="${escapeHtml(categoryId)}" data-value="${escapeHtml(value)}" aria-label="${removeLabel}">×</button>
                    `;
                    container.appendChild(tag);
                });
            } else if (values && values.min !== undefined) {
                // Range filter chip: "Label: min ~ max"
                const tag = document.createElement('span');
                tag.className = 'filter-tag';
                tag.innerHTML = `
                    ${escapeHtml(`${I18n.getName(category.label)}: ${values.min} ~ ${values.max}`)}
                    <button class="filter-tag-remove" data-category="${escapeHtml(categoryId)}" data-range="true" aria-label="${removeLabel}">×</button>
                `;
                container.appendChild(tag);
            }
        }

        // Add remove button listeners
        container.querySelectorAll('.filter-tag-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const catId = btn.getAttribute('data-category');
                if (btn.hasAttribute('data-range')) {
                    removeFilter(catId);
                } else {
                    let val = btn.getAttribute('data-value');
                    // data-* attributes are strings; boolean filters store real booleans
                    if (getCategory(catId)?.type === 'boolean') val = (val === 'true');
                    removeFilter(catId, val);
                }
                syncCategoryUI(catId);
            });
        });
    }

    /**
     * Open/close the autocomplete list and keep the combobox ARIA in sync
     */
    function setAutocompleteOpen(container, open) {
        if (!container) return;
        container.classList.toggle('active', open);
        const input = document.getElementById('searchInput');
        if (input) {
            input.setAttribute('aria-expanded', String(open));
            if (!open) input.removeAttribute('aria-activedescendant');
        }
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
        const seriesCategory = getCategory('series');
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
            setAutocompleteOpen(container, false);
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

        const typeLabel = {
            product: I18n.t('search.typeProduct'),
            series: I18n.t('search.typeSeries'),
            model: I18n.t('search.typeModel'),
            history: '🕒'
        };
        const removeHistoryLabel = escapeHtml(I18n.t('search.removeHistory'));

        // Render suggestions (escape: history entries are raw user input)
        container.innerHTML = finalSuggestions.map((s, i) => `
            <div class="autocomplete-item ${s.type === 'history' ? 'history-item' : ''}" id="ac-option-${i}" role="option" aria-selected="false" data-value="${escapeHtml(s.value)}" data-type="${s.type}">
                <span class="autocomplete-item-type ${s.type}">${escapeHtml(typeLabel[s.type])}</span>
                <span class="autocomplete-item-text">${s.match ? highlightMatch(s.text, s.match) : escapeHtml(s.text)}</span>
                ${s.type === 'history' ? '<button class="history-delete-btn" data-query="' + escapeHtml(s.value) + '" aria-label="' + removeHistoryLabel + '">×</button>' : ''}
            </div>
        `).join('');

        // Add click handlers for suggestions
        container.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Don't trigger if clicking delete button
                if (e.target.classList.contains('history-delete-btn')) return;

                const value = item.getAttribute('data-value');
                const input = document.getElementById('searchInput');
                cancelPendingSearch();
                if (input) input.value = value;
                setSearchQuery(value, { commit: true, source: input });
                setAutocompleteOpen(container, false);
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

        setAutocompleteOpen(container, true);
    }

    /**
     * Highlight matching text (escapes both sides so raw text is never
     * injected as HTML; escaping is applied consistently, so indexOf still works)
     */
    function highlightMatch(text, match) {
        const safeText = escapeHtml(text);
        const safeMatch = escapeHtml(match);
        const index = safeText.toLowerCase().indexOf(safeMatch.toLowerCase());
        if (index === -1) return safeText;
        return safeText.slice(0, index) + '<mark>' + safeText.slice(index, index + safeMatch.length) + '</mark>' + safeText.slice(index + safeMatch.length);
    }

    /**
     * Update selected autocomplete item
     */
    function updateSelectedItem(items, index) {
        items.forEach((item, i) => {
            item.classList.toggle('selected', i === index);
            item.setAttribute('aria-selected', String(i === index));
        });
        const input = document.getElementById('searchInput');
        if (items[index]) {
            items[index].scrollIntoView({ block: 'nearest' });
            input?.setAttribute('aria-activedescendant', items[index].id);
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
            // Input event - show autocomplete and filter
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.trim();

                // Show autocomplete suggestions
                if (query.length >= 1 && autocomplete) {
                    showAutocompleteSuggestions(query, autocomplete);
                    selectedIndex = -1;
                } else {
                    setAutocompleteOpen(autocomplete, false);
                }

                // Debounced search (not committed to history)
                cancelPendingSearch();
                searchDebounce = setTimeout(() => {
                    setSearchQuery(query, { source: searchInput });
                }, 300);
            });

            // Keyboard: suggestion navigation, Enter to submit, Escape to close
            searchInput.addEventListener('keydown', (e) => {
                const open = autocomplete?.classList.contains('active');
                const items = open ? autocomplete.querySelectorAll('.autocomplete-item') : [];

                if (e.key === 'ArrowDown' && items.length) {
                    e.preventDefault();
                    selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                    updateSelectedItem(items, selectedIndex);
                } else if (e.key === 'ArrowUp' && items.length) {
                    e.preventDefault();
                    selectedIndex = Math.max(selectedIndex - 1, 0);
                    updateSelectedItem(items, selectedIndex);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (selectedIndex >= 0 && items[selectedIndex]) {
                        items[selectedIndex].click();
                    } else {
                        cancelPendingSearch();
                        setSearchQuery(searchInput.value, { commit: true, source: searchInput });
                        setAutocompleteOpen(autocomplete, false);
                    }
                    selectedIndex = -1;
                } else if (e.key === 'Escape' && open) {
                    setAutocompleteOpen(autocomplete, false);
                    selectedIndex = -1;
                }
            });

            // Hide on blur (with delay for click)
            searchInput.addEventListener('blur', () => {
                setTimeout(() => setAutocompleteOpen(autocomplete, false), 200);
            });

            // Show on focus if has value
            searchInput.addEventListener('focus', (e) => {
                const query = e.target.value.trim();
                if (query.length >= 1 && autocomplete) {
                    showAutocompleteSuggestions(query, autocomplete);
                }
            });
        }

        // Search button (magnifier icon) — triggers an immediate search
        const searchBtn = document.getElementById('searchBtn');
        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                const input = document.getElementById('searchInput');
                cancelPendingSearch();
                if (input) setSearchQuery(input.value, { commit: true, source: input });
                setAutocompleteOpen(autocomplete, false);
            });
        }

        // Mobile search (no autocomplete; Enter submits)
        const mobileSearchInput = document.getElementById('mobileSearchInput');
        if (mobileSearchInput) {
            mobileSearchInput.addEventListener('input', (e) => {
                cancelPendingSearch();
                searchDebounce = setTimeout(() => {
                    setSearchQuery(e.target.value, { source: mobileSearchInput });
                }, 300);
            });
            mobileSearchInput.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                cancelPendingSearch();
                setSearchQuery(mobileSearchInput.value, { commit: true, source: mobileSearchInput });
                mobileSearchInput.blur(); // dismiss the on-screen keyboard
            });
        }

        // Reset button
        const resetBtn = document.getElementById('filterResetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', clearAllFilters);
        }

        // Quick reset button (in results area)
        const quickResetBtn = document.getElementById('quickResetBtn');
        if (quickResetBtn) {
            quickResetBtn.addEventListener('click', clearAllFilters);
        }

        // Active filters summary toggle
        const activeFiltersSummary = document.getElementById('activeFiltersSummary');
        if (activeFiltersSummary) {
            activeFiltersSummary.addEventListener('click', () => {
                const wrapper = document.getElementById('activeFiltersWrapper');
                if (wrapper) {
                    const expanded = wrapper.classList.toggle('expanded');
                    activeFiltersSummary.setAttribute('aria-expanded', String(expanded));
                }
            });
        }

        // Language change - rebuild filter UI and localized chips
        document.addEventListener('langChange', () => {
            buildFilterUI();
            restoreFilterUIState();
            updateActiveFiltersUI();
        });
    }

    /**
     * Make every category's controls reflect activeFilters
     * (after a rebuild, a reset, or a URL change)
     */
    function restoreFilterUIState() {
        (taxonomy?.categories || []).forEach(c => syncCategoryUI(c.id));
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
            } else if (values && typeof values === 'object' && values.min !== undefined) {
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
            searchQuery = params.get('q').trim().toLowerCase();
        }
        syncSearchInputs(searchQuery, null);

        params.forEach((value, key) => {
            if (key === 'q') return;

            const category = getCategory(key);
            if (!category) return;

            if (category.type === 'range') {
                const [min, max] = value.split('-').map(Number);
                if (!isNaN(min) && !isNaN(max)) activeFilters[key] = { min, max };
            } else if (category.type === 'boolean') {
                // URL params are strings; convert back to real booleans so they
                // compare correctly against product data (true !== "true")
                activeFilters[key] = value.split(',').map(v => v === 'true');
            } else {
                activeFilters[key] = value.split(',');
            }
        });
    }

    /**
     * Re-read filters + search from the current URL and refresh the sidebar.
     * Used on back/forward navigation; does not dispatch filterChange — the
     * caller re-renders for the view it restores.
     */
    function syncFromURL() {
        cancelPendingSearch();
        activeFilters = {};
        searchQuery = '';
        restoreFromURL();
        restoreFilterUIState();
        updateActiveFiltersUI();
        updateQuickResetVisibility();
    }

    /**
     * Dispatch filter change event
     */
    function dispatchFilterChange() {
        updateQuickResetVisibility();
        document.dispatchEvent(new CustomEvent('filterChange', {
            detail: { filters: activeFilters, query: searchQuery }
        }));
    }

    // Public API
    return {
        init,
        getTaxonomy,
        getCategory,
        getActiveFilters,
        setSearchQuery,
        setFilter,
        toggleFilter,
        setRangeFilter,
        removeFilter,
        clearAllFilters,
        matchesFilters,
        syncFromURL
    };
})();

// Export
window.Filter = Filter;
