#!/usr/bin/env node
/**
 * Data validation — build-time backend layer.
 *
 * Checks everything the static app trusts blindly at runtime:
 *   - data/gunpla-index.json      shape, unique ids, taxonomy values, image urls
 *   - data/gunpla-details/*.json  one file per index product, consistent with the index
 *   - data/taxonomy.json          option ids / labels
 *   - data/i18n.json              ko/en key parity, every key used by the UI exists
 *
 * Usage:
 *   node scripts/validate-data.mjs            human-readable report
 *   node scripts/validate-data.mjs --json     machine-readable report
 *   node scripts/validate-data.mjs --strict   warnings also fail the run
 *
 * Exit code: 0 = ok, 1 = errors (or warnings with --strict), 2 = could not run.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const DETAILS = join(DATA, 'gunpla-details');

const args = new Set(process.argv.slice(2));
const issues = [];
const error = (where, msg) => issues.push({ level: 'error', where, msg });
const warn = (where, msg) => issues.push({ level: 'warning', where, msg });

function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
        error(path.replace(ROOT, '').replace(/\\/g, '/'), `invalid JSON: ${e.message}`);
        return null;
    }
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const hasLocalized = v => isObj(v) && typeof v.ko === 'string' && v.ko && typeof v.en === 'string' && v.en;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// gunpla.fyi boxarts are addressed by a numeric id (a slug 404s)
const BOXART_RE = /^https:\/\/gunpla\.fyi\/images\/boxarts\/(\d+)(?:\.jpe?g|\.png)?$/;

// ---------------------------------------------------------------- taxonomy
const taxonomy = readJson(join(DATA, 'taxonomy.json'));
const categories = new Map();
if (taxonomy) {
    if (!Array.isArray(taxonomy.categories)) error('taxonomy.json', 'categories must be an array');
    for (const c of taxonomy.categories || []) {
        const where = `taxonomy.json#${c.id}`;
        if (categories.has(c.id)) error(where, 'duplicate category id');
        categories.set(c.id, c);
        if (!hasLocalized(c.label)) error(where, 'label needs ko + en');
        if (!['single', 'multiple', 'boolean', 'range'].includes(c.type)) error(where, `unknown type "${c.type}"`);
        if (c.type === 'range') {
            if (typeof c.min !== 'number' || typeof c.max !== 'number' || c.min > c.max) error(where, 'range needs numeric min <= max');
        } else {
            const values = (c.options || []).map(o => o.value);
            if (!values.length) error(where, 'options missing');
            if (new Set(values.map(String)).size !== values.length) error(where, 'duplicate option values');
            (c.options || []).forEach(o => { if (!hasLocalized(o.label)) error(where, `option ${o.value}: label needs ko + en`); });
        }
    }
}

/**
 * Validate one value against its taxonomy category
 */
function checkTaxonomyValue(where, catId, value, report = error) {
    const c = categories.get(catId);
    if (!c || value === undefined || value === null) return;
    const allowed = new Set((c.options || []).map(o => o.value));
    switch (c.type) {
        case 'range':
            if (typeof value !== 'number' || value < c.min || value > c.max) report(where, `${catId}=${JSON.stringify(value)} outside ${c.min}..${c.max}`);
            break;
        case 'boolean':
            if (typeof value !== 'boolean') report(where, `${catId} must be true/false, got ${JSON.stringify(value)}`);
            break;
        case 'multiple':
            (Array.isArray(value) ? value : [value]).forEach(v => {
                if (!allowed.has(v)) report(where, `${catId}: unknown value "${v}"`);
            });
            break;
        default:
            if (!allowed.has(value)) report(where, `${catId}: unknown value ${JSON.stringify(value)}`);
    }
}

// ---------------------------------------------------------------- index
const index = readJson(join(DATA, 'gunpla-index.json'));
const products = Array.isArray(index?.products) ? index.products : [];
if (index && !Array.isArray(index.products)) error('gunpla-index.json', 'products must be an array');
if (index?.meta && index.meta.totalCount !== products.length) {
    error('gunpla-index.json#meta', `totalCount ${index.meta.totalCount} ≠ ${products.length} products`);
}

const ids = new Set();
const thumbIds = new Map();
for (const p of products) {
    const where = `index#${p.id ?? '?'}`;
    if (!ID_RE.test(p.id || '')) error(where, 'id must be a lowercase slug');
    if (ids.has(p.id)) error(where, 'duplicate id');
    ids.add(p.id);

    if (!hasLocalized(p.name)) error(where, 'name needs ko + en');
    if (!Number.isInteger(p.releaseYear)) error(where, 'releaseYear must be an integer');
    if (typeof p.price !== 'number' || p.price <= 0) error(where, 'price must be a positive number');
    if (!isObj(p.filterData)) error(where, 'filterData missing');
    if (p.bandaiManualId !== undefined && !/^\d+$/.test(String(p.bandaiManualId))) error(where, 'bandaiManualId must be numeric');

    for (const catId of categories.keys()) {
        checkTaxonomyValue(where, catId, p[catId] ?? p.filterData?.[catId]);
    }

    const m = BOXART_RE.exec(p.thumbnail || '');
    if (!m) error(where, `thumbnail is not a gunpla.fyi numeric boxart url: ${p.thumbnail}`);
    else thumbIds.set(m[1], [...(thumbIds.get(m[1]) || []), p.id]);
}
for (const [thumb, owners] of thumbIds) {
    if (owners.length > 1) warn(`index#${owners.join(',')}`, `share the same boxart id ${thumb}`);
}

// ---------------------------------------------------------------- details
const CONSISTENT_FIELDS = ['grade', 'scale', 'series', 'releaseYear', 'price', 'modelNumber', 'releaseLine', 'isRevive', 'isVerKa', 'bandaiManualId'];
const LOCALIZED_LISTS = ['weapons', 'accessories', 'pros', 'cons', 'buildingTips'];
const detailFiles = existsSync(DETAILS) ? readdirSync(DETAILS).filter(f => f.endsWith('.json')) : [];
const detailIds = new Set(detailFiles.map(f => f.replace(/\.json$/, '')));
let unknownRefs = 0;
let slugBoxarts = 0;
const specIssues = new Map(); // message -> product ids

for (const id of detailIds) {
    if (!ids.has(id)) error(`gunpla-details/${id}.json`, 'no matching product in the index');
}

for (const p of products) {
    const where = `gunpla-details/${p.id}.json`;
    if (!detailIds.has(p.id)) {
        error(where, 'missing (every index product needs a detail file)');
        continue;
    }
    const d = readJson(join(DETAILS, `${p.id}.json`));
    if (!d) continue;

    if (d.id !== p.id) error(where, `id "${d.id}" does not match the file name`);
    if (!hasLocalized(d.name)) error(where, 'name needs ko + en');
    else if (d.name.ko !== p.name.ko || d.name.en !== p.name.en) error(where, 'name differs from the index');
    for (const f of CONSISTENT_FIELDS) {
        if (JSON.stringify(d[f]) !== JSON.stringify(p[f])) error(where, `${f} differs from the index (${JSON.stringify(d[f])} vs ${JSON.stringify(p[f])})`);
    }
    if (d.releaseMonth !== undefined && !(Number.isInteger(d.releaseMonth) && d.releaseMonth >= 1 && d.releaseMonth <= 12)) {
        error(where, 'releaseMonth must be 1..12');
    }

    // Collected and reported once per distinct problem (see below)
    for (const [catId, value] of Object.entries(d.fullSpecs || {})) {
        checkTaxonomyValue(p.id, catId, value, (id, msg) => specIssues.set(msg, [...(specIssues.get(msg) || []), id]));
    }

    for (const f of LOCALIZED_LISTS) {
        if (d[f] === undefined) continue;
        if (!isObj(d[f]) || !Array.isArray(d[f].ko) || !Array.isArray(d[f].en)) error(where, `${f} needs ko[] + en[]`);
    }
    const perfectFor = d.recommendation?.perfectFor;
    if (perfectFor && (!Array.isArray(perfectFor.ko) || !Array.isArray(perfectFor.en))) error(where, 'recommendation.perfectFor needs ko[] + en[]');

    const boxart = d.images?.boxart;
    if (boxart && !BOXART_RE.test(boxart)) slugBoxarts++;
    for (const url of d.images?.gallery || []) {
        if (!/^https:\/\//.test(url)) error(where, `gallery url must be https: ${url}`);
    }

    for (const ref of [...(d.variants || []), ...(d.relatedGrades || [])]) {
        if (!ref.id || !hasLocalized(ref.name)) error(where, 'variant/relatedGrade needs id + name ko/en');
        else if (!ids.has(ref.id)) unknownRefs++;
    }
}
for (const [msg, owners] of specIssues) {
    const sample = owners.slice(0, 3).join(', ') + (owners.length > 3 ? ', …' : '');
    warn(`gunpla-details/*#fullSpecs`, `${msg} — ${owners.length} file(s): ${sample}`);
}
if (slugBoxarts) {
    warn('gunpla-details/*', `${slugBoxarts} images.boxart values are not numeric gunpla.fyi ids (the page falls back to the index thumbnail)`);
}
if (unknownRefs) {
    warn('gunpla-details/*', `${unknownRefs} variant/related-grade links point to kits not in the index (shown as "details not available")`);
}

// ---------------------------------------------------------------- i18n
const i18n = readJson(join(DATA, 'i18n.json'));
if (i18n) {
    const flatten = (o, prefix = '') => Object.entries(o || {}).flatMap(([k, v]) =>
        isObj(v) ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
    const ko = new Set(flatten(i18n.translations?.ko));
    const en = new Set(flatten(i18n.translations?.en));
    [...ko].filter(k => !en.has(k)).forEach(k => error('i18n.json', `"${k}" has no English text`));
    [...en].filter(k => !ko.has(k)).forEach(k => error('i18n.json', `"${k}" has no Korean text`));

    const used = new Set();
    for (const file of ['index.html', 'detail.html']) {
        const html = readFileSync(join(ROOT, file), 'utf8');
        for (const m of html.matchAll(/data-i18n(?:-placeholder|-title|-aria-label)?="([^"]+)"/g)) used.add(m[1]);
    }
    for (const file of readdirSync(join(ROOT, 'js')).filter(f => f.endsWith('.js'))) {
        const js = readFileSync(join(ROOT, 'js', file), 'utf8');
        for (const m of js.matchAll(/I18n\.t\('([^']+)'/g)) used.add(m[1]);
        // keys passed around as plain strings, e.g. setToggleState(btn, on, 'product.addToFavorites', …)
        for (const m of js.matchAll(/'((?:product|search|favorites|compare|common|notif|filter|theme|nav|recent|gallery|view|sort)\.[a-zA-Z]+)'/g)) used.add(m[1]);
    }
    [...used].filter(k => !ko.has(k)).forEach(k => error('i18n.json', `"${k}" is used by the UI but not defined`));
}

// ---------------------------------------------------------------- report
const errors = issues.filter(i => i.level === 'error');
const warnings = issues.filter(i => i.level === 'warning');
const failed = errors.length > 0 || (args.has('--strict') && warnings.length > 0);

if (args.has('--json')) {
    console.log(JSON.stringify({ ok: !failed, products: products.length, errors, warnings }, null, 2));
} else {
    for (const i of issues) {
        console.log(`${i.level === 'error' ? '✖' : '⚠'} ${i.where}: ${i.msg}`);
    }
    console.log(`\n${products.length} products, ${detailIds.size} detail files — ${errors.length} error(s), ${warnings.length} warning(s)`);
    console.log(failed ? 'FAILED' : 'OK');
}
process.exit(failed ? 1 : 0);
