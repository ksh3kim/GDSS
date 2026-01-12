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
        getMobilityText
    };
})();

// Export for use in other modules
window.I18n = I18n;
