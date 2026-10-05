import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildSearchUrl, categoriesFor, queryCandidates, parseManualResults,
    rankManualResults, pickMatch, splitOfficialName, searchManual, manualDetailUrl
} from '../lib/manual.js';
import { fixture, stubFetch } from './helpers.js';

const rgRx78 = { grade: 'RG', modelNumber: 'RX-78-2', nameEn: 'RX-78-2 Gundam', releaseYear: 2010 };

test('buildSearchUrl uses freeword + repeated categories[] (keyword= is ignored by the site)', () => {
    const url = new URL(buildSearchUrl({ freeword: 'RX-78-2', categories: [1, 5], page: 2 }));
    assert.equal(url.origin + url.pathname, 'https://manual.bandai-hobby.net/menus');
    assert.equal(url.searchParams.get('freeword'), 'RX-78-2');
    assert.deepEqual(url.searchParams.getAll('categories[]'), ['1', '5']);
    assert.equal(url.searchParams.get('page'), '2');
    assert.equal(url.searchParams.has('keyword'), false);
    assert.equal(manualDetailUrl('656'), 'https://manual.bandai-hobby.net/menus/detail/656');
});

test('categoriesFor maps our grades to the site categories', () => {
    assert.deepEqual(categoriesFor('RG'), [10]);
    assert.deepEqual(categoriesFor('HGCE'), [1, 5]);
    assert.deepEqual(categoriesFor('pgu'), [9]);
    assert.deepEqual(categoriesFor('UNKNOWN'), []);
});

test('queryCandidates: plain model number first, then distinctive name words', () => {
    assert.deepEqual(queryCandidates(rgRx78), ['RX-78-2']);
    assert.deepEqual(queryCandidates({ modelNumber: 'RX-93', nameEn: 'Nu Gundam Ver.Ka' }), ['RX-93', 'ν']);
    // "+" makes it a combined code — not searchable; "00" is too short
    assert.deepEqual(queryCandidates({ modelNumber: 'GN-0000+GNR-010', nameEn: '00 Raiser' }), ['RAISER']);
    assert.deepEqual(queryCandidates({ modelNumber: 'STTS-909', nameEn: 'Rising Freedom Gundam' }), ['STTS-909', 'FREEDOM', 'RISING']);
});

test('splitOfficialName separates the line and drops the scale', () => {
    assert.deepEqual(splitOfficialName('PG UNLEASHED 1/60 RX-78-2 GUNDAM'), { grade: 'PGU', tokens: ['RX-78-2', 'GUNDAM'] });
    assert.deepEqual(splitOfficialName('HGUC 1/144 νGUNDAM'), { grade: 'HGUC', tokens: ['NU', 'GUNDAM'] });
    assert.deepEqual(splitOfficialName('MG 1/100 MSN-06S SINANJU STEIN Ver. Ka').tokens, ['MSN-06S', 'SINANJU', 'STEIN', 'VER.KA']);
    assert.equal(splitOfficialName('ENTRY GRADE 1/144 RX-78-2 GUNDAM').grade, 'EG');
});

test('parseManualResults reads only result blocks (en name, ja fallback, year, safe img)', () => {
    const { total, results } = parseManualResults(fixture('manual-search.html'));
    assert.equal(total, 3);
    assert.deepEqual(results.map(r => r.id), ['656', '1585', '2517']);
    assert.equal(results[0].nameEn, 'RG 1/144 RX-78-2 GUNDAM');
    assert.equal(results[0].releaseYear, 2010);
    assert.equal(results[0].url, 'https://manual.bandai-hobby.net/menus/detail/656');
    assert.equal(results[2].nameEn, '');
    assert.match(results[2].nameJa, /武器セット/);
    assert.equal(results[2].img, '', 'non-http image urls are dropped');
    assert.deepEqual(parseManualResults(fixture('manual-empty.html')), { total: 0, results: [] });
});

test('ranking picks the exact kit over newer versions and accessories', () => {
    const ranked = rankManualResults(parseManualResults(fixture('manual-search.html')).results, rgRx78);
    assert.equal(ranked[0].id, '656');
    assert.equal(pickMatch(ranked).id, '656');
});

const result = (id, nameEn, releaseYear) => ({ id, url: manualDetailUrl(id), nameEn, nameJa: '', releaseYear, img: '' });

test('a different kit that merely shares words is rejected (no wrong manual)', () => {
    const sinanjuVerKa = { grade: 'MG', modelNumber: 'MSN-06S', nameEn: 'Sinanju Ver.Ka', releaseYear: 2012 };
    const ranked = rankManualResults([
        result('606', 'MG 1/100 MSN-06S SINANJU STEIN Ver. Ka', 2013),
        result('564', 'MG 1/100 SINANJU', 2008)
    ], sinanjuVerKa);
    assert.equal(pickMatch(ranked), null);
});

test('mode words disambiguate kits with the same base name', () => {
    const destroy = { grade: 'HGUC', modelNumber: 'RX-0', nameEn: 'Unicorn Gundam Destroy Mode', releaseYear: 2009 };
    const ranked = rankManualResults([
        result('922', 'HGUC 1/144 RX-0 UNICORN GUNDAM (UNICORN MODE)', 2009),
        result('919', 'HGUC 1/144 RX-0 UNICORN GUNDAM (DESTROY MODE)', 2009)
    ], destroy);
    assert.equal(pickMatch(ranked).id, '919');
});

test('same name in two years: the release year breaks the tie', () => {
    const revive = { grade: 'HG', modelNumber: 'RX-78-2', nameEn: 'RX-78-2 Gundam', releaseYear: 2015 };
    const ranked = rankManualResults([
        result('221', 'HGUC 1/144 RX-78-2 GUNDAM', 2001),
        result('1004', 'HGUC 1/144 RX-78-2 GUNDAM', 2015)
    ], revive);
    assert.equal(pickMatch(ranked).id, '1004');
});

test('another line (grade) never matches', () => {
    const pgu = { grade: 'PGU', modelNumber: 'RX-78-2', nameEn: 'RX-78-2 Gundam', releaseYear: 2020 };
    const ranked = rankManualResults([result('985', 'PG 1/60 RX-78-2 GUNDAM', 1998)], pgu);
    assert.equal(pickMatch(ranked), null);
});

test('searchManual widens past an empty category and returns the match', async () => {
    const stub = stubFetch(url => {
        const u = new URL(url);
        if (u.searchParams.getAll('categories[]').length) return fixture('manual-empty.html');
        return fixture('manual-search.html');
    });
    try {
        const out = await searchManual(rgRx78);
        assert.equal(out.match.id, '656');
        assert.equal(stub.calls.length, 2, 'category search, then widened search');
        assert.match(out.searchUrl, /freeword=RX-78-2/);
        assert.match(out.searchUrl, /categories%5B%5D=10/);
    } finally {
        stub.restore();
    }
});

test('searchManual throws only when the site is unreachable', async () => {
    const stub = stubFetch(() => { throw new Error('network down'); });
    try {
        await assert.rejects(searchManual(rgRx78));
    } finally {
        stub.restore();
    }
});
