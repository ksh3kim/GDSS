#!/usr/bin/env node
/**
 * Manual-id backfill — build-time backend layer.
 *
 * Looks every product up on the official Bandai manual site (same search +
 * ranking as the Worker's /api/manual, serverless/lib/manual.js) and, with
 * --write, stores confident matches as `bandaiManualId` in
 * data/gunpla-index.json and data/gunpla-details/<id>.json. The detail page
 * then links straight to /menus/detail/<id> with no runtime API at all.
 *
 * Only confident matches are written; ambiguous kits keep linking to the
 * search page. Products that already have a bandaiManualId are skipped
 * unless --force is given (hand-verified ids win).
 *
 * Usage:
 *   node scripts/resolve-manual-ids.mjs                 dry run (report only)
 *   node scripts/resolve-manual-ids.mjs --write         write confident matches
 *   node scripts/resolve-manual-ids.mjs --only rg-exia,mg-exia
 *   node scripts/resolve-manual-ids.mjs --force --write re-resolve existing ids too
 *   node scripts/resolve-manual-ids.mjs --delay 800     pause between kits (ms, default 500)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchManual } from '../serverless/lib/manual.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = join(ROOT, 'data', 'gunpla-index.json');
const DETAILS = join(ROOT, 'data', 'gunpla-details');

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

const WRITE = flag('--write');
const FORCE = flag('--force');
const ONLY = option('--only')?.split(',').map(s => s.trim()).filter(Boolean);
const DELAY = Number(option('--delay') ?? 500);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Insert/replace bandaiManualId right after modelNumber, keeping key order
 */
function withManualId(obj, manualId) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (k === 'bandaiManualId') continue;
        out[k] = v;
        if (k === 'modelNumber') out.bandaiManualId = manualId;
    }
    if (!('bandaiManualId' in out)) out.bandaiManualId = manualId;
    return out;
}

const writeJson = (path, data) => writeFileSync(path, JSON.stringify(data, null, 4) + '\n', 'utf8');

const index = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
const targets = index.products.filter(p =>
    (!ONLY || ONLY.includes(p.id)) && (FORCE || !p.bandaiManualId));

console.log(`Resolving ${targets.length} product(s)${WRITE ? '' : ' (dry run — add --write to save)'}\n`);

const found = new Map();
let failed = 0;
for (const p of targets) {
    try {
        const r = await searchManual({
            grade: p.grade,
            modelNumber: p.modelNumber,
            nameEn: p.name.en,
            releaseYear: p.releaseYear
        });
        if (r.match) {
            found.set(p.id, r.match.id);
            console.log(`✔ ${p.id.padEnd(26)} → ${r.match.id.padStart(5)}  ${r.match.nameEn || r.match.nameJa} (${r.match.releaseYear ?? '?'})`);
        } else {
            const best = r.candidates[0];
            console.log(`– ${p.id.padEnd(26)}   no confident match${best ? `; closest: ${best.id} ${best.nameEn || best.nameJa} (${best.releaseYear ?? '?'})` : ''}`);
        }
    } catch (e) {
        failed++;
        console.log(`✖ ${p.id.padEnd(26)}   lookup failed: ${e.message}`);
    }
    await sleep(DELAY);
}

console.log(`\n${found.size} matched, ${targets.length - found.size - failed} unresolved, ${failed} failed`);

if (WRITE && found.size) {
    index.products = index.products.map(p => (found.has(p.id) ? withManualId(p, found.get(p.id)) : p));
    writeJson(INDEX_PATH, index);
    for (const [id, manualId] of found) {
        const path = join(DETAILS, `${id}.json`);
        if (!existsSync(path)) continue;
        writeJson(path, withManualId(JSON.parse(readFileSync(path, 'utf8')), manualId));
    }
    console.log(`Wrote bandaiManualId for ${found.size} product(s). Run: node scripts/validate-data.mjs`);
}

process.exit(failed && !found.size ? 1 : 0);
