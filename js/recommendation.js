/**
 * Gunpla Guide - Recommendation Module
 * Handles product scoring, matching, and recommendation explanations
 */

const Recommendation = (function () {

    // Weight factors for different filter categories
    const categoryWeights = {
        difficulty: 3,
        mobility: 2.5,
        grade: 2,
        recommendedUser: 2.5,
        weaponCount: 1.5,
        frameType: 1.5,
        transformation: 1.5,
        colorSeparation: 1,
        sealDependency: 1,
        clearParts: 0.5,
        coatingParts: 0.5
    };

    /**
     * Calculate match score between product and active filters
     * @param {Object} product - Product data
     * @param {Object} filters - Active filters
     * @returns {number} Score between 0-100
     */
    function calculateMatchScore(product, filters) {
        if (!filters || Object.keys(filters).length === 0) {
            return 0; // No filters, no score
        }

        let totalWeight = 0;
        let matchedWeight = 0;

        for (const [categoryId, filterValues] of Object.entries(filters)) {
            const weight = categoryWeights[categoryId] || 1;
            totalWeight += weight;

            let productValue = product[categoryId] ?? product.filterData?.[categoryId];

            if (productValue === undefined) continue;

            // Check match
            if (Array.isArray(filterValues)) {
                if (Array.isArray(productValue)) {
                    // Multiple product values - check overlap
                    const overlap = productValue.filter(v => filterValues.includes(v));
                    matchedWeight += weight * (overlap.length / filterValues.length);
                } else if (filterValues.includes(productValue)) {
                    matchedWeight += weight;
                }
            } else if (typeof filterValues === 'object' && filterValues.min !== undefined) {
                // Range filter
                if (productValue >= filterValues.min && productValue <= filterValues.max) {
                    matchedWeight += weight;
                }
            } else if (productValue === filterValues) {
                matchedWeight += weight;
            }
        }

        if (totalWeight === 0) return 0;

        return Math.round((matchedWeight / totalWeight) * 100);
    }

    /**
     * Generate recommendation explanation for a product
     * @param {Object} product - Product data
     * @param {Object} filters - Active filters
     * @returns {Object} Explanation object with tags and text
     */
    function generateExplanation(product, filters) {
        const lang = I18n.getLang();
        const matchedReasons = [];
        const tags = [];

        // Analyze each filter match
        for (const [categoryId, filterValues] of Object.entries(filters)) {
            const productValue = product[categoryId] ?? product.filterData?.[categoryId];
            if (productValue === undefined) continue;

            let matched = false;

            if (Array.isArray(filterValues)) {
                if (Array.isArray(productValue)) {
                    matched = productValue.some(v => filterValues.includes(v));
                } else {
                    matched = filterValues.includes(productValue);
                }
            } else if (typeof filterValues === 'object' && filterValues.min !== undefined) {
                matched = productValue >= filterValues.min && productValue <= filterValues.max;
            } else {
                matched = productValue === filterValues;
            }

            if (matched) {
                const reason = getMatchReason(categoryId, productValue, filterValues);
                if (reason) {
                    matchedReasons.push(reason);
                    tags.push(categoryId);
                }
            }
        }

        // Add product-specific tags
        if (product.tags) {
            tags.push(...product.tags.slice(0, 3));
        }

        // Build explanation text
        let explanation = '';
        if (matchedReasons.length > 0) {
            if (lang === 'ko') {
                explanation = `선택한 조건에 맞는 제품입니다. ${matchedReasons.join(', ')}.`;
            } else {
                explanation = `This product matches your criteria. ${matchedReasons.join(', ')}.`;
            }
        }

        return {
            tags: [...new Set(tags)].slice(0, 5),
            text: explanation,
            matchedCount: matchedReasons.length
        };
    }

    /**
     * Get human-readable match reason for a category
     */
    function getMatchReason(categoryId, productValue, filterValue) {
        const lang = I18n.getLang();

        const reasonsMap = {
            difficulty: {
                ko: {
                    beginner: '초보자도 쉽게 조립 가능',
                    intermediate: '적당한 난이도로 성취감 있음',
                    advanced: '도전적인 조립 경험 제공'
                },
                en: {
                    beginner: 'Easy for beginners',
                    intermediate: 'Moderate challenge with satisfaction',
                    advanced: 'Challenging build experience'
                }
            },
            mobility: {
                ko: val => val >= 4 ? '우수한 가동성' : val >= 3 ? '보통 수준의 가동성' : '제한적인 가동성',
                en: val => val >= 4 ? 'Excellent articulation' : val >= 3 ? 'Moderate mobility' : 'Limited mobility'
            },
            frameType: {
                ko: {
                    full: '풀 이너 프레임 구조',
                    partial: '부분 프레임 구조',
                    none: '심플한 구조'
                },
                en: {
                    full: 'Full inner frame structure',
                    partial: 'Partial frame structure',
                    none: 'Simple structure'
                }
            },
            weaponCount: {
                ko: {
                    many: '다양한 무장 포함',
                    standard: '기본 무장 구성',
                    few: '심플한 무장'
                },
                en: {
                    many: 'Many weapons included',
                    standard: 'Standard armament',
                    few: 'Minimal weapons'
                }
            },
            transformation: {
                ko: true ? '변형 기믹 탑재' : null,
                en: true ? 'Transformation gimmick' : null
            },
            colorSeparation: {
                ko: {
                    high: '도색 없이도 완성도 높음',
                    medium: '부분 도색 권장',
                    low: '도색 권장'
                },
                en: {
                    high: 'Great out of box',
                    medium: 'Partial painting recommended',
                    low: 'Painting recommended'
                }
            },
            recommendedUser: {
                ko: {
                    beginner: '입문자에게 적합',
                    posing: '포징에 최적화',
                    display: '전시용으로 추천',
                    collector: '수집가 추천',
                    painter: '도색러에게 추천',
                    detail: '디테일 중시자에게 추천'
                },
                en: {
                    beginner: 'Great for beginners',
                    posing: 'Optimized for posing',
                    display: 'Recommended for display',
                    collector: 'Collector\'s pick',
                    painter: 'Great for painters',
                    detail: 'For detail enthusiasts'
                }
            }
        };

        const reasonData = reasonsMap[categoryId];
        if (!reasonData) return null;

        const langReasons = reasonData[lang] || reasonData.ko;

        if (typeof langReasons === 'function') {
            return langReasons(productValue);
        }

        if (Array.isArray(productValue)) {
            const matched = productValue.find(v => langReasons[v]);
            return matched ? langReasons[matched] : null;
        }

        return langReasons[productValue] || null;
    }

    /**
     * Generate pros/cons summary for recommendation panel
     */
    function getQuickSummary(product) {
        const lang = I18n.getLang();
        const filterData = product.filterData || {};

        const pros = [];
        const cons = [];

        // Analyze product attributes
        if (filterData.difficulty === 'beginner') {
            pros.push(lang === 'ko' ? '조립 쉬움' : 'Easy build');
        } else if (filterData.difficulty === 'advanced') {
            cons.push(lang === 'ko' ? '난이도 높음' : 'Challenging');
        }

        if (filterData.mobility >= 4) {
            pros.push(lang === 'ko' ? '가동성 우수' : 'Great mobility');
        } else if (filterData.mobility <= 2) {
            cons.push(lang === 'ko' ? '가동성 제한' : 'Limited mobility');
        }

        if (filterData.colorSeparation === 'high') {
            pros.push(lang === 'ko' ? '색분할 우수' : 'Great color separation');
        } else if (filterData.colorSeparation === 'low') {
            cons.push(lang === 'ko' ? '도색 필요' : 'Painting needed');
        }

        if (filterData.sealDependency === 'required') {
            cons.push(lang === 'ko' ? '씰 필수' : 'Stickers required');
        } else if (filterData.sealDependency === 'none') {
            pros.push(lang === 'ko' ? '씰 불필요' : 'No stickers needed');
        }

        if (filterData.transformation) {
            pros.push(lang === 'ko' ? '변형 기믹' : 'Transformation');
        }

        if (filterData.weaponCount === 'many') {
            pros.push(lang === 'ko' ? '무장 풍부' : 'Many weapons');
        } else if (filterData.weaponCount === 'few') {
            cons.push(lang === 'ko' ? '무장 적음' : 'Few weapons');
        }

        if (filterData.frameType === 'full') {
            pros.push(lang === 'ko' ? '풀프레임' : 'Full frame');
        }

        return {
            pros: pros.slice(0, 4),
            cons: cons.slice(0, 3)
        };
    }

    /**
     * Sort products by match score
     */
    function sortByScore(products, filters) {
        return products.map(product => ({
            ...product,
            matchScore: calculateMatchScore(product, filters)
        })).sort((a, b) => b.matchScore - a.matchScore);
    }

    /**
     * Get recommendation panel content
     */
    function getRecommendationPanelContent(filters) {
        const lang = I18n.getLang();
        const items = [];

        for (const [categoryId, values] of Object.entries(filters)) {
            const category = Filter.getTaxonomy()?.categories?.find(c => c.id === categoryId);
            if (!category) continue;

            let label = I18n.getName(category.label);
            let value = '';

            if (Array.isArray(values)) {
                const options = values.map(v => {
                    const opt = category.options?.find(o => o.value === v);
                    return opt ? I18n.getName(opt.label) : v;
                });
                value = options.join(', ');
            } else if (typeof values === 'object' && values.min !== undefined) {
                value = `${values.min} ~ ${values.max}`;
            }

            if (value) {
                items.push({ label, value });
            }
        }

        return {
            title: lang === 'ko' ? '현재 필터 조건' : 'Current Filter Criteria',
            items
        };
    }

    // Public API
    return {
        calculateMatchScore,
        generateExplanation,
        getQuickSummary,
        sortByScore,
        getRecommendationPanelContent
    };
})();

// Export
window.Recommendation = Recommendation;
