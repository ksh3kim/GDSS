/**
 * Gunpla Guide - i18n (Internationalization) Module
 * Handles Korean/English language switching
 */

const I18n = (function () {
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
            const savedLang = localStorage.getItem('gunpla-lang');
            const browserLang = navigator.language.startsWith('ko') ? 'ko' : 'en';
            currentLang = savedLang || browserLang;

            // Apply translations
            applyTranslations();
            updateLangToggle();

        } catch (error) {
            console.error('Failed to load translations:', error);
        }
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
        if (lang !== 'ko' && lang !== 'en') return;

        currentLang = lang;
        localStorage.setItem('gunpla-lang', lang);
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

        // Update page title
        const titleKey = document.body.classList.contains('detail-page')
            ? 'site.title'
            : 'site.title';
        document.title = t(titleKey);
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

    /**
     * Get mobility text
     */
    function getMobilityText(level) {
        return t(`mobility.${level}`);
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
            '--color-dark-text': c.text
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

        // Update active state in menu
        document.querySelectorAll('.theme-option').forEach(opt => {
            opt.classList.toggle('active', opt.getAttribute('data-theme') === theme);
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
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.classList.toggle('active');
            });

            // Close on outside click
            document.addEventListener('click', () => {
                dropdown.classList.remove('active');
            });

            // Theme option clicks
            dropdown.querySelectorAll('.theme-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    const newTheme = opt.getAttribute('data-theme');
                    setTheme(newTheme);
                    // Keep the dropdown open on custom so colors can be edited
                    if (newTheme !== 'custom') {
                        dropdown.classList.remove('active');
                    }
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

        // Setup mobile theme grid
        const mobileThemeGrid = document.getElementById('mobileThemeGrid');
        if (mobileThemeGrid) {
            mobileThemeGrid.querySelectorAll('.mobile-theme-btn').forEach(btn => {
                // Set initial active state
                btn.classList.toggle('active', btn.getAttribute('data-theme') === theme);
                btn.addEventListener('click', () => {
                    const newTheme = btn.getAttribute('data-theme');
                    setTheme(newTheme);
                    // Update mobile buttons active state
                    mobileThemeGrid.querySelectorAll('.mobile-theme-btn').forEach(b => {
                        b.classList.toggle('active', b.getAttribute('data-theme') === newTheme);
                    });
                });
            });
        }

        // Sync mobile buttons when theme changes from desktop dropdown
        document.addEventListener('themeChange', (e) => {
            const grid = document.getElementById('mobileThemeGrid');
            if (grid) {
                grid.querySelectorAll('.mobile-theme-btn').forEach(b => {
                    b.classList.toggle('active', b.getAttribute('data-theme') === e.detail.theme);
                });
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
        getMobilityText,
        getTheme,
        setTheme,
        initTheme
    };
})();

// Export for use in other modules
window.I18n = I18n;