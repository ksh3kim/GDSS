import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBandaiNews, parseNextNews, parseFeed, aggregateNews, SOURCES } from '../lib/news.js';
import { fixture, stubFetch } from './helpers.js';

const bandai = SOURCES.find(s => s.type === 'bandai-html');
const gundam = SOURCES.find(s => s.type === 'next-news');
const rss = { name: 'Some RSS', url: 'https://feeds.example/rss', type: 'rss', icon: '📰' };

test('parseBandaiNews reads the news list: tag → kind, JST date, safe links only', () => {
    const items = parseBandaiNews(fixture('bandai-news.html'), bandai);
    assert.equal(items.length, 3, 'javascript: link must be dropped');
    assert.deepEqual(items.map(i => i.kind), ['news', 'shop', 'product']);
    assert.equal(items[0].title, 'ガンプラユーザーアンケートキャンペーン！');
    assert.equal(items[0].link, 'https://bandai-hobby.net/news/01_7421/');
    assert.equal(items[0].ts, Date.parse('2026-09-30T15:00:00Z'), '2026-10-01 00:00 JST');
    assert.equal(items[0].img, 'https://cdn.example/hobby/topics.jpg?Expires=1&Signature=x');
    assert.equal(items[1].link, 'https://p-bandai.jp/item/item-1000257894/');
    assert.deepEqual(Object.keys(items[0]).sort(), ['icon', 'img', 'kind', 'link', 'source', 'title', 'ts']);
});

test('parseNextNews decodes the streamed Next.js payload', () => {
    const items = parseNextNews(fixture('gundam-news.html'), gundam);
    assert.equal(items.length, 3);
    assert.equal(items[0].title, 'The Latest "Gunpla" Lineup Releasing in October 2026!');
    assert.equal(items[0].ts, Date.parse('2026-10-01T03:00:00.000Z'));
    assert.equal(items[0].kind, 'product');
    assert.equal(items[1].title, 'Event Details for October at & "THE GUNDAM BASE" Revealed!');
    assert.equal(items[1].kind, 'news', 'an event that mentions Gunpla is not kit news');
    assert.equal(items[2].link, 'https://en.gundam-official.com/news/ccc333');
    assert.equal(items[2].img, '');
    assert.equal(items[2].kind, 'shop', 'GUNPLA pre-order');
});

test('parseNextNews returns [] when the payload shape changes', () => {
    assert.deepEqual(parseNextNews('<html><script>self.__next_f.push([1,"nothing here"])</script></html>', gundam), []);
    assert.deepEqual(parseNextNews('', gundam), []);
});

test('parseFeed still reads generic RSS and Atom sources', () => {
    const fromRss = parseFeed(fixture('rss.xml'), rss);
    assert.equal(fromRss.length, 3, 'javascript: link must be dropped');
    assert.equal(fromRss[0].title, 'HG 1/144 Gundam Aerial & friends');
    assert.equal(fromRss[0].img, 'https://bandai-hobby.net/images/aerial.jpg');
    assert.equal(fromRss[1].img, 'https://bandai-hobby.net/images/older.jpg');

    const fromAtom = parseFeed(fixture('atom.xml'), rss);
    assert.equal(fromAtom[0].title, 'New MG announced', 'escaped markup in type="html" titles is removed');
    assert.equal(fromAtom[0].link, 'https://en.gundam.info/news/mg/');
    assert.equal(fromAtom[0].img, 'https://en.gundam.info/img/mg.png');
});

test('aggregateNews merges sources newest first, de-duplicates, survives a dead source', async () => {
    const stub = stubFetch(url => {
        if (url === bandai.url) return fixture('bandai-news.html');
        if (url === gundam.url) return fixture('gundam-news.html');
        if (url === rss.url) return fixture('rss.xml');
        return new Response('<html>404</html>', { status: 200 });
    });
    try {
        const all = await aggregateNews({ sources: [bandai, gundam], limit: 50 });
        assert.deepEqual(all.sources.map(s => s.ok), [true, true]);
        assert.equal(all.items.length, 6);
        const ts = all.items.map(i => i.ts);
        assert.deepEqual(ts, [...ts].sort((a, b) => b - a), 'newest first');
        assert.equal(new Set(all.items.map(i => i.link)).size, all.items.length);

        // A page that loads but has no items (moved / redesigned) counts as a failed source
        const partial = await aggregateNews({ sources: [bandai, { ...gundam, url: 'https://moved.example/' }] });
        assert.deepEqual(partial.sources.map(s => s.ok), [true, false]);
        assert.equal(partial.sources[1].error, 'no_items_parsed');

        const limited = await aggregateNews({ sources: [bandai, gundam, rss], limit: 2 });
        assert.equal(limited.items.length, 2);
    } finally {
        stub.restore();
    }
});

test('configured sources are https and use a known reader', () => {
    SOURCES.forEach(s => {
        assert.match(s.url, /^https:\/\//);
        assert.ok(['bandai-html', 'next-news', 'rss'].includes(s.type));
    });
});
