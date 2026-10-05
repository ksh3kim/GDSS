/**
 * Bandai official manual lookup (manual.bandai-hobby.net).
 *
 * The site has no API; its search page is server-rendered HTML:
 *   GET /menus?freeword=<text>&categories[]=<grade category id>&page=<n>
 * `freeword` is matched as ONE substring of the kit name (a space-separated
 * "RG RX-78-2" finds nothing), so queries are single model numbers or words.
 *
 * Shared by the Worker (/api/manual, runtime) and scripts/resolve-manual-ids.mjs
 * (build time, writes verified ids into the data files).
 */

import { fetchText, cleanText } from './net.js';

export const MANUAL_ORIGIN = 'https://manual.bandai-hobby.net';

// Category ids from the site's search form. HG-family lines without their
// own category (HGCE, HGAC, HGIBO, HGTWFM, …) are filed under plain HG (1),
// and kits we label "HG" are sometimes filed under HGUC (5) — search both.
const HG_FAMILY = [1, 5];
export const GRADE_CATEGORIES = {
    HG: HG_FAMILY, HGCE: HG_FAMILY, HGAC: HG_FAMILY, HGAW: HG_FAMILY, HGFC: HG_FAMILY, HGCC: HG_FAMILY,
    HGBD: HG_FAMILY, HGBF: HG_FAMILY, HGIBO: HG_FAMILY, HGTWFM: HG_FAMILY,
    HGUC: [5, 1],
    EG: [2],
    FM: [4],
    MG: [6],
    MGEX: [7],
    PG: [9], PGU: [9],
    RG: [10],
    SDEX: [14],
    SDCS: [35],
    RE100: [133]
};

// How each line is written at the start of the official English kit name
const GRADE_PREFIXES = [
    ['PGU', /^PG UNLEASHED\b/],
    ['PG', /^PG\b/],
    ['MGEX', /^MGEX\b/],
    ['MGSD', /^MGSD\b/],
    ['MG', /^MG\b/],
    ['RG', /^RG\b/],
    ['EG', /^ENTRY GRADE\b/],
    ['FM', /^FULL MECHANICS\b/],
    ['SDCS', /^SD(?:CS| GUNDAM CROSS SILHOUETTE)\b/],
    ['SDEX', /^SD(?:EX| GUNDAM EX-STANDARD)\b/],
    ['RE100', /^RE\/100\b/],
    ['HG', /^HG[A-Z]*\b/]
];

// Words that say nothing about WHICH kit it is
const GENERIC_WORDS = new Set(['GUNDAM', 'MODE', 'II', 'III', 'EW', 'THE', 'OF', 'AND', 'FOR']);
// Words that mark an accessory / add-on rather than the kit itself
const ACCESSORY_WORDS = new Set(['WEAPON', 'WEAPONS', 'SET', 'PARTS', 'UNIT', 'EXPANSION', 'EFFECT', 'LED', 'DECAL', 'STAND', 'OPTION', 'BOOSTER', 'CUSTOMIZE']);

// A candidate counts as "the" manual only when its name is clearly the same
// kit — or fairly similar AND released the same year in the same line —
// and it beats the runner-up by a clear margin. Unsure → no match (the
// caller falls back to the search page instead of a wrong manual).
const STRONG_NAME = 0.8;
const FAIR_NAME = 0.6;
const MIN_MARGIN = 0.1;

export function manualDetailUrl(id) {
    return `${MANUAL_ORIGIN}/menus/detail/${encodeURIComponent(id)}`;
}

export function buildSearchUrl({ freeword = '', categories = [], page = 1 } = {}) {
    const params = new URLSearchParams();
    if (freeword) params.set('freeword', freeword);
    (categories || []).forEach(c => params.append('categories[]', String(c)));
    if (page > 1) params.set('page', String(page));
    return `${MANUAL_ORIGIN}/menus?${params.toString()}`;
}

export function categoriesFor(grade) {
    return GRADE_CATEGORIES[String(grade || '').toUpperCase()] || [];
}

/**
 * Upper-case and fold the spelling differences between our data and the
 * official names: Ⅱ→II, ν→NU, "Ver. Ka"→"VER.KA", full-width brackets, OO→00
 */
export function normalizeName(s) {
    return String(s || '')
        .normalize('NFKC')
        .toUpperCase()
        .replace(/Ⅱ/g, 'II').replace(/Ⅲ/g, 'III')
        .replace(/[Νν]/g, 'NU ')
        .replace(/[’‘`]/g, "'")
        .replace(/\bVER\.\s+/g, 'VER.')
        .replace(/\bOO\b/g, '00')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(s) {
    return normalizeName(s)
        .split(/[\s()[\]{}、,:;!?"]+/)
        .map(t => t.replace(/^[^A-Z0-9]+|[^A-Z0-9.]+$/g, ''))
        .filter(Boolean);
}

/**
 * Split an official English kit name into its line (grade) and the
 * remaining name tokens (scale removed)
 */
export function splitOfficialName(nameEn) {
    let rest = normalizeName(nameEn);
    let grade = null;
    for (const [g, re] of GRADE_PREFIXES) {
        const m = re.exec(rest);
        if (m) {
            grade = g === 'HG' ? m[0] : g; // keep HGUC / HGCE / … as written
            rest = rest.slice(m[0].length);
            break;
        }
    }
    const tokens = tokenize(rest).filter(t => !/^1\/\d+$/.test(t));
    return { grade, tokens };
}

function gradeMatches(productGrade, officialGrade) {
    if (!officialGrade) return false;
    const pg = String(productGrade || '').toUpperCase();
    if (pg.startsWith('HG')) return officialGrade.startsWith('HG');
    return pg === officialGrade;
}

/**
 * Search terms to try, most specific first: the model number (only when it
 * is a plain code like RX-78-2 — official names often contain it), then the
 * most distinctive words of the English name.
 */
export function queryCandidates(product) {
    const out = [];
    const model = String(product.modelNumber || '').trim().toUpperCase();
    if (/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(model)) out.push(model);

    const words = tokenize(product.nameEn || '')
        .map(t => (t === 'NU' ? 'ν' : t)) // the site spells Nu Gundam with the Greek letter
        .filter(t => !GENERIC_WORDS.has(t) && !/^VER\./.test(t) && (t.length >= 3 || t === 'ν') && t !== model)
        .sort((a, b) => b.length - a.length);
    for (const w of words) {
        if (!out.includes(w)) out.push(w);
    }
    return out.slice(0, 4);
}

/**
 * Parse one search-results page into
 *   { total, results: [{ id, url, nameJa, nameEn, releaseYear, img }] }
 */
export function parseManualResults(html) {
    const totalMatch = /([\d,]+)\s*件の結果/.exec(html);
    const total = totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : 0;

    const results = [];
    const chunks = String(html).split(/<div class="bl_result_item">/).slice(1);
    for (const chunk of chunks) {
        const idMatch = /href="\/menus\/detail\/(\d+)"/.exec(chunk);
        if (!idMatch) continue;
        const enMatch = /<span class="bl_result_name_en">([\s\S]*?)<\/span>/.exec(chunk);
        const jaMatch = /<div class="bl_result_name">([\s\S]*?)(?:<span class="bl_result_name_en">|<\/div>)/.exec(chunk);
        const dateMatch = /<dd>[^<]*?(\d{4})年[^<]*<\/dd>/.exec(chunk);
        const imgMatch = /<div class="bl_result_img">\s*<img[^>]*src="([^"]+)"/.exec(chunk);
        results.push({
            id: idMatch[1],
            url: manualDetailUrl(idMatch[1]),
            nameJa: jaMatch ? cleanText(jaMatch[1]) : '',
            nameEn: enMatch ? cleanText(enMatch[1]) : '',
            releaseYear: dateMatch ? Number(dateMatch[1]) : null,
            img: imgMatch && /^https?:\/\//i.test(imgMatch[1]) ? imgMatch[1] : ''
        });
    }
    return { total, results };
}

/**
 * Score every candidate against the product (higher = better).
 * `nameScore` is the token-set similarity of the names; the total adds small
 * bonuses for the model number, the release year and the exact line, and
 * applies heavy penalties for another line (grade) or an accessory
 * (weapon set, LED unit, …).
 */
export function rankManualResults(results, product) {
    const productTokens = new Set(tokenize(product.nameEn || ''));
    const model = String(product.modelNumber || '').trim().toUpperCase();
    const productGrade = String(product.grade || '').toUpperCase();

    return results.map(r => {
        const { grade, tokens } = splitOfficialName(r.nameEn || r.nameJa);
        const hasModel = Boolean(model) && tokens.includes(model) && !productTokens.has(model);
        const resultTokens = new Set(tokens.filter(t => !(hasModel && t === model)));

        let inter = 0;
        resultTokens.forEach(t => { if (productTokens.has(t)) inter++; });
        const union = new Set([...productTokens, ...resultTokens]).size || 1;

        const nameScore = inter / union;
        const sameYear = Boolean(product.releaseYear) && r.releaseYear === Number(product.releaseYear);
        const exactGrade = Boolean(grade) && productGrade === grade;
        const gradeOk = gradeMatches(productGrade, grade);
        const accessory = [...resultTokens].some(t => ACCESSORY_WORDS.has(t) && !productTokens.has(t));

        let score = nameScore + (hasModel ? 0.1 : 0) + (sameYear ? 0.1 : 0) + (exactGrade ? 0.05 : 0);
        if (!gradeOk) score *= 0.3;
        if (accessory) score *= 0.5;

        return {
            ...r,
            score: Math.round(score * 100) / 100,
            nameScore: Math.round(nameScore * 100) / 100,
            sameYear,
            exactGrade,
            gradeOk,
            accessory
        };
    }).sort((a, b) => b.score - a.score);
}

/**
 * The best candidate when it is clearly the product, otherwise null
 */
export function pickMatch(ranked) {
    const [best, second] = ranked;
    if (!best || !best.gradeOk || best.accessory) return null;
    const confident = best.nameScore >= STRONG_NAME ||
        (best.nameScore >= FAIR_NAME && best.sameYear && best.exactGrade);
    if (!confident) return null;
    if (second && best.score - second.score < MIN_MARGIN - 1e-9) return null;
    return best;
}

/**
 * Run the lookup against the live site.
 * product: { grade, modelNumber, nameEn, releaseYear }
 * Resolves to { match, candidates, searchUrl, requests }.
 * Throws only when the site could not be reached at all.
 */
export async function searchManual(product, { timeoutMs = 8000, maxRequests = 6 } = {}) {
    const categories = categoriesFor(product.grade);
    const queries = queryCandidates(product);
    const pool = new Map();
    const requests = [];
    let reached = false;
    let lastError = null;
    let ranked = [];

    const fetchPage = async (freeword, cats, page = 1) => {
        const url = buildSearchUrl({ freeword, categories: cats, page });
        requests.push(url);
        try {
            const parsed = parseManualResults(await fetchText(url, { timeoutMs, attempts: 1 }));
            reached = true;
            return parsed;
        } catch (e) {
            lastError = e;
            return { total: 0, results: [] };
        }
    };

    for (const q of queries) {
        if (requests.length >= maxRequests) break;

        // Narrow by grade first; widen if the category guess finds nothing
        let cats = categories;
        let page = await fetchPage(q, cats);
        if (!page.results.length && cats.length && requests.length < maxRequests) {
            cats = [];
            page = await fetchPage(q, cats);
        }
        // Results come 20 per page, newest first — older kits may sit on page 2
        if (page.total > page.results.length && requests.length < maxRequests) {
            const next = await fetchPage(q, cats, 2);
            page.results.push(...next.results);
        }
        page.results.forEach(r => pool.set(r.id, r));

        ranked = rankManualResults([...pool.values()], product);
        if (pickMatch(ranked)) break;
    }

    if (!reached) throw lastError || new Error('manual_site_unreachable');

    return {
        match: pickMatch(ranked),
        candidates: ranked.slice(0, 5),
        searchUrl: buildSearchUrl({ freeword: queries[0] || product.nameEn || '', categories }),
        requests: requests.length
    };
}
