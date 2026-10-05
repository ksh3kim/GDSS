/**
 * Gunpla Guide - i18n (Internationalization) Module
 * Handles Korean/English language switching
 */

const I18n = (function () {
    const LANG_KEY = 'gunpla-lang';
    const SUPPORTED_LANGS = ['ko', 'en'];
    let currentLang = 'ko';
    let translations = {};

    /**
     * Initialize i18n module
     */
    async function init() {
        // Load translations
        try {
            const response = await fetch('data/i18n.json');
            const data = await response.json();
            translations = data.translations;

            // Detect browser language or use saved preference
            // (an invalid stored value would make every t() return its key)
            let savedLang = null;
            try { savedLang = localStorage.getItem(LANG_KEY); } catch (e) { /* storage blocked */ }
            const browserLang = (navigator.language || '').startsWith('ko') ? 'ko' : 'en';
            currentLang = SUPPORTED_LANGS.includes(savedLang) ? savedLang : browserLang;

            // Apply translations
            applyTranslations();
            updateLangToggle();

            // Modules that rendered text before the translations arrived
            // (e.g. the news panel) re-render on this
            document.dispatchEvent(new CustomEvent('i18nReady', { detail: { lang: currentLang } }));

        } catch (error) {
            console.error('Failed to load translations:', error);
        }

        // Follow language changes made in other tabs
        window.addEventListener('storage', (e) => {
            if (e.key === LANG_KEY && SUPPORTED_LANGS.includes(e.newValue) && e.newValue !== currentLang) {
                setLang(e.newValue);
            }
        });
    }

    /**
     * Get current language
     */
    function getLang() {
        return currentLang;
    }

    /**
     * Set language
     */
    function setLang(lang) {
        if (!SUPPORTED_LANGS.includes(lang)) return;

        currentLang = lang;
        try {
            localStorage.setItem(LANG_KEY, lang);
        } catch (e) {
            console.warn('Failed to save language:', e);
        }
        applyTranslations();
        updateLangToggle();

        // Dispatch event for other modules
        document.dispatchEvent(new CustomEvent('langChange', { detail: { lang } }));
    }

    /**
     * Toggle between languages
     */
    function toggleLang() {
        setLang(currentLang === 'ko' ? 'en' : 'ko');
    }

    /**
     * Get translation by key path (e.g., 'nav.home')
     */
    function t(keyPath, replacements = {}) {
        const keys = keyPath.split('.');
        let value = translations[currentLang];

        for (const key of keys) {
            if (value && typeof value === 'object') {
                value = value[key];
            } else {
                return keyPath; // Return key if translation not found
            }
        }

        if (typeof value !== 'string') {
            return keyPath;
        }

        // Replace placeholders like {{count}}
        return value.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            return replacements[key] !== undefined ? replacements[key] : match;
        });
    }

    /**
     * Get localized name from object { ko: '...', en: '...' }
     */
    function getName(obj) {
        if (!obj) return '';
        if (typeof obj === 'string') return obj;
        return obj[currentLang] || obj.ko || obj.en || '';
    }

    /**
     * Apply translations to all elements with data-i18n attribute
     */
    function applyTranslations() {
        // Text content
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            el.textContent = t(key);
        });

        // Placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = t(key);
        });

        // Tooltips and accessible names
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.title = t(el.getAttribute('data-i18n-title'));
        });
        document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
            el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
        });

        // Screen readers pick pronunciation from the document language
        document.documentElement.lang = currentLang;

        // Update page title (detail pages re-set it with the product name
        // in renderProductDetail after this runs)
        document.title = t('site.title');
    }

    /**
     * Update language toggle button appearance
     */
    function updateLangToggle() {
        const toggles = document.querySelectorAll('.lang-toggle, .mobile-lang-toggle');
        toggles.forEach(toggle => {
            toggle.setAttribute('data-lang', currentLang);
        });
    }

    /**
     * Format price in Yen
     */
    function formatPrice(price) {
        if (!price) return '-';
        return `¥${price.toLocaleString()}`;
    }

    /**
     * Format date based on language
     */
    function formatDate(year, month) {
        if (!year) return '-';
        if (!month) return `${year}`;

        if (currentLang === 'ko') {
            return `${year}년 ${month}월`;
        } else {
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return `${monthNames[month - 1]} ${year}`;
        }
    }

    /**
     * Get difficulty text
     */
    function getDifficultyText(difficulty) {
        const difficultyMap = {
            'beginner': { ko: '초보', en: 'Beginner' },
            'intermediate': { ko: '중급', en: 'Intermediate' },
            'advanced': { ko: '상급', en: 'Advanced' }
        };
        return difficultyMap[difficulty]?.[currentLang] || difficulty;
    }

    // ===== Theme Management =====
    const THEME_KEY = 'gunpla-theme';
    const CUSTOM_KEY = 'gunpla-theme-custom';
    const DEFAULT_THEME = 'dark';
    const VALID_THEMES = ['dark', 'light', 'trueblack', 'rx78', 'char', 'zeon', 'unicorn', 'eva', 'custom'];

    // Default custom palette (based on the default dark theme)
    const DEFAULT_CUSTOM = {
        primary: '#E31837',
        accent: '#FBBF24',
        bg: '#0D1117',
        surface: '#161B22',
        text: '#C9D1D9'
    };

    /**
     * Lighten (p>0) or darken (p<0) a hex color. p in range -1..1
     */
    function shade(hex, p) {
        let h = String(hex || '').replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        const num = parseInt(h, 16);
        if (isNaN(num)) return hex;
        let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
        const t = p < 0 ? 0 : 255, a = Math.abs(p);
        r = Math.round((t - r) * a) + r;
        g = Math.round((t - g) * a) + g;
        b = Math.round((t - b) * a) + b;
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    /**
     * Build the full CSS variable map for a custom palette
     */
    function customVars(c) {
        return {
            '--color-primary': c.primary,
            '--color-primary-dark': shade(c.primary, -0.2),
            '--color-primary-light': shade(c.primary, 0.2),
            '--color-accent': c.accent,
            '--color-accent-dark': shade(c.accent, -0.2),
            '--theme-bg': c.bg,
            '--color-dark-bg': c.bg,
            '--theme-surface': c.surface,
            '--color-dark-surface': c.surface,
            '--theme-card-bg': c.surface,
            '--theme-border': shade(c.surface, 0.12),
            '--color-dark-border': shade(c.surface, 0.12),
            '--theme-text': c.text,
            '--color-dark-text': c.text,
            '--theme-heading': c.text
        };
    }

    /**
     * Get saved custom palette merged with defaults
     */
    function getCustomColors() {
        try {
            const saved = JSON.parse(localStorage.getItem(CUSTOM_KEY) || 'null');
            return Object.assign({}, DEFAULT_CUSTOM, saved || {});
        } catch (e) {
            return Object.assign({}, DEFAULT_CUSTOM);
        }
    }

    /**
     * Persist custom palette
     */
    function saveCustomColors(colors) {
        try {
            localStorage.setItem(CUSTOM_KEY, JSON.stringify(colors));
        } catch (e) {
            console.warn('Failed to save custom colors:', e);
        }
    }

    /**
     * Apply custom palette as inline CSS variables on <html>
     */
    function applyCustomColors(colors) {
        const s = document.documentElement.style;
        const map = customVars(colors);
        Object.keys(map).forEach(k => { if (map[k]) s.setProperty(k, map[k]); });
    }

    /**
     * Remove all inline custom CSS variables from <html>
     */
    function clearCustomColors() {
        const s = document.documentElement.style;
        Object.keys(customVars(DEFAULT_CUSTOM)).forEach(k => s.removeProperty(k));
    }

    /**
     * Toggle visibility of the custom color panel(s)
     */
    function updateCustomizerVisibility(theme) {
        document.querySelectorAll('.theme-customizer').forEach(p => {
            p.classList.toggle('active', theme === 'custom');
        });
    }

    /**
     * Get current theme from localStorage
     */
    function getTheme() {
        try {
            const saved = localStorage.getItem(THEME_KEY);
            return VALID_THEMES.includes(saved) ? saved : DEFAULT_THEME;
        } catch (e) {
            return DEFAULT_THEME;
        }
    }

    /**
     * Set theme and apply to document
     */
    function setTheme(theme) {
        if (!VALID_THEMES.includes(theme)) theme = DEFAULT_THEME;

        // Apply to document
        if (theme === 'dark') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }

        // Apply or clear custom inline colors
        if (theme === 'custom') {
            applyCustomColors(getCustomColors());
        } else {
            clearCustomColors();
        }
        updateCustomizerVisibility(theme);

        // Save to localStorage
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch (e) {
            console.warn('Failed to save theme:', e);
        }

        // Update active state in the desktop menu and the mobile grid
        document.querySelectorAll('.theme-option, .mobile-theme-btn').forEach(opt => {
            const isActive = opt.getAttribute('data-theme') === theme;
            opt.classList.toggle('active', isActive);
            opt.setAttribute('aria-pressed', String(isActive));
        });

        // Dispatch theme change event for cross-page sync
        document.dispatchEvent(new CustomEvent('themeChange', { detail: { theme } }));
    }

    /**
     * Initialize theme from saved preference
     */
    function initTheme() {
        const theme = getTheme();
        setTheme(theme);

        // Setup dropdown toggle
        const toggleBtn = document.getElementById('themeToggleBtn');
        const dropdown = toggleBtn?.closest('.theme-dropdown');

        if (toggleBtn && dropdown) {
            const setOpen = (open) => {
                dropdown.classList.toggle('active', open);
                toggleBtn.setAttribute('aria-expanded', String(open));
            };

            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const willOpen = !dropdown.classList.contains('active');
                setOpen(willOpen);
                // Only one header popup at a time (the news panel closes itself)
                if (willOpen) document.dispatchEvent(new CustomEvent('dropdownOpen', { detail: { id: 'theme' } }));
            });

            document.addEventListener('dropdownOpen', (e) => {
                if (e.detail?.id !== 'theme') setOpen(false);
            });

            // Close on outside click / Escape
            document.addEventListener('click', () => setOpen(false));
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && dropdown.classList.contains('active')) {
                    setOpen(false);
                    toggleBtn.focus();
                }
            });

            // Theme option clicks
            dropdown.querySelectorAll('.theme-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    const newTheme = opt.getAttribute('data-theme');
                    setTheme(newTheme);
                    // Keep the dropdown open on custom so colors can be edited
                    if (newTheme !== 'custom') setOpen(false);
                });
            });
        }

        // Setup custom color pickers (desktop + mobile share the wiring)
        const customInputs = document.querySelectorAll('[data-custom]');
        if (customInputs.length) {
            const cc = getCustomColors();
            customInputs.forEach(inp => {
                const key = inp.getAttribute('data-custom');
                inp.value = cc[key] || DEFAULT_CUSTOM[key];
                inp.addEventListener('input', () => {
                    const colors = getCustomColors();
                    colors[key] = inp.value;
                    saveCustomColors(colors);
                    // Ensure custom theme is active and reflect changes live
                    if (getTheme() !== 'custom') {
                        setTheme('custom');
                    } else {
                        applyCustomColors(colors);
                    }
                    // Sync sibling inputs with the same key
                    document.querySelectorAll('[data-custom="' + key + '"]').forEach(o => {
                        if (o !== inp) o.value = inp.value;
                    });
                });
            });
        }

        // Reflect initial custom-panel visibility
        updateCustomizerVisibility(theme);

        // Prevent clicks inside the customizer from closing the dropdown
        document.querySelectorAll('.theme-customizer').forEach(panel => {
            panel.addEventListener('click', e => e.stopPropagation());
        });

        // Setup mobile theme grid (active state is kept in sync by setTheme)
        const mobileThemeGrid = document.getElementById('mobileThemeGrid');
        if (mobileThemeGrid) {
            mobileThemeGrid.querySelectorAll('.mobile-theme-btn').forEach(btn => {
                btn.addEventListener('click', () => setTheme(btn.getAttribute('data-theme')));
            });
        }

        // Follow theme / custom-palette changes made in other tabs
        window.addEventListener('storage', (e) => {
            if (e.key === THEME_KEY) {
                setTheme(getTheme());
            } else if (e.key === CUSTOM_KEY) {
                const colors = getCustomColors();
                customInputs.forEach(inp => {
                    const key = inp.getAttribute('data-custom');
                    inp.value = colors[key] || DEFAULT_CUSTOM[key];
                });
                if (getTheme() === 'custom') applyCustomColors(colors);
            }
        });
    }

    // Public API
    return {
        init,
        getLang,
        setLang,
        toggleLang,
        t,
        getName,
        applyTranslations,
        formatPrice,
        formatDate,
        getDifficultyText,
        getTheme,
        setTheme,
        initTheme
    };
})();

// Export for use in other modules
window.I18n = I18n;