# Verify: GunList static web app

## Launch
```bash
cd <repo-root>
python -m http.server 8777 --bind 127.0.0.1   # background; Python 3.14 on PATH
```
Node v24 and Edge headless are available:
`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`

## Drive (two proven handles)

**1. Self-driving DOM harness** — write a temp `__verify__.html` in the repo root
(same-origin requirement) that loads `index.html` / `detail.html?id=...` in
iframes, clicks buttons, asserts state, and logs `PASS/FAIL` lines into a
`<pre id="out">`. Then:
```bash
msedge --headless=new --disable-gpu --user-data-dir=<fresh-tmp> \
  --virtual-time-budget=60000 --dump-dom http://127.0.0.1:8777/__verify__.html
```
Grep the dumped `<pre>` for results. Console errors: add
`--enable-logging=stderr --v=1` and grep stderr for `CONSOLE`.
Delete `__verify__.html` afterwards.

Harness gotchas:
- Seed `localStorage['gunpla-news-cache'] = {ts: Date.now(), items:[...]}` first
  so notifications skip external CORS-proxy fetches (deterministic, offline-safe).
- Override `iframe.contentWindow.confirm = () => true` before clicking the
  footer reset buttons.
- Dispatch inputs with the iframe realm's Event: `new (ifr.contentWindow.Event)('input', {bubbles:true})`.
- Recent-viewed strip shows with `style.display === 'flex'` (not 'block').

**2. CDP via Node built-in WebSocket** (no Playwright needed) — for viewport
screenshots and computed-style probes. Launch Edge with
`--remote-debugging-port=<port>`, poll `http://127.0.0.1:<port>/json`, connect
`new WebSocket(target.webSocketDebuggerUrl)`, then send
`Emulation.setDeviceMetricsOverride` + `Page.navigate` + `Page.captureScreenshot`
/ `Runtime.evaluate`.

## ⚠️ Biggest gotcha
`msedge --headless --window-size=375,...` screenshots are **unreliable** — they
can render a layout that does not match a true 375px viewport (produced a
false "hamburger button missing" alarm). Always use CDP
`Emulation.setDeviceMetricsOverride` for viewport-accurate captures.

## Flows worth driving
search → filter count / view+sort toggles / favorite·compare badges / compare
tab (table-only, column remove) / lang KO↔EN / theme incl. custom panel /
notif bell badge+seen / reload persistence / two-iframe storage sync /
footer reset (confirm) / detail page: action buttons, manual link href,
recent strip, gallery arrows / mobile menu toggle.
