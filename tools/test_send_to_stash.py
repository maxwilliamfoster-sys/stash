"""BetterSpotify "Send to Stash" -> Stash "Paste", end to end, in WebKit as an iPhone 13.

Usage: py tools/test_send_to_stash.py <outdir> [playlist_url]
Needs ../BetterSpotify-Safari/dist/betterspotify.user.js (py tools/build.py there). Signed out,
so it uses a public playlist; Liked Songs uses the same song list and can only be checked on the
phone. The clipboard is replaced by a stand-in that records what BetterSpotify copies.
"""

import base64
import functools
import http.server
import json
import os
import sys
import threading
import zlib
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BSP = ROOT.parent / "BetterSpotify-Safari" / "dist" / "betterspotify.user.js"
out = Path(sys.argv[1] if len(sys.argv) > 1 else "test_out_send")
out.mkdir(parents=True, exist_ok=True)
PLAYLIST = sys.argv[2] if len(sys.argv) > 2 else "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
PORT = 8769

failures = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg, flush=True)
    if not cond:
        failures.append(msg)


CLIP = """
(() => {
  const rec = (t) => { window.__clip = t; return Promise.resolve(); };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: rec,
    write: async (items) => { const b = await items[0].getType('text/plain'); return rec(await b.text()); },
  }});
})();
"""
SEED = "try { localStorage.setItem('better-spotify-safari', JSON.stringify({fullMode: true})); } catch (e) {}"
GM = "window.GM = {xmlHttpRequest: () => Promise.reject(new Error('offline in test'))};"


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    browser = p.webkit.launch()
    ctx = browser.new_context(**p.devices["iPhone 13"], locale="en-GB", ignore_https_errors=True)
    ctx.add_init_script(SEED + CLIP + GM + "\n" + BSP.read_text(encoding="utf-8"))
    page = ctx.new_page()
    page.goto(PLAYLIST, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_selector("#bsp-stash", timeout=30000)
    total = page.evaluate("[...document.querySelectorAll('#main-view [role=grid][aria-rowcount]')].map(g => +g.getAttribute('aria-rowcount') - 1).filter(n => n > 0).pop()")
    page.screenshot(path=str(out / "t1_button.png"))
    page.locator("#bsp-stash").click()
    page.wait_for_function("window.__clip || /Tap to copy|Couldn/.test(document.querySelector('#bsp-stash').textContent)", timeout=60000)
    if "Tap to copy" in page.locator("#bsp-stash").inner_text():
        page.locator("#bsp-stash").click()
        page.wait_for_function("window.__clip", timeout=5000)
    clip = page.evaluate("window.__clip || ''")
    label = page.locator("#bsp-stash").inner_text()
    check(clip.startswith("STASH1:"), f"Send to Stash copies a STASH1 playlist ({len(clip)} characters, button says {label!r})")
    b64 = clip[7:]
    data = json.loads(zlib.decompress(base64.urlsafe_b64decode(b64 + "=" * (-len(b64) % 4)), -15))
    items = data["items"]
    print("info:", data["name"], len(items), "songs; first:", items[0] if items else None, flush=True)
    check(len(items) == total and total > 25, f"every song collected, past the first screen ({len(items)} of {total})")
    check(all(i[0] and i[1] and i[3] > 30 for i in items), "each song has a title, artist and length")
    check(sum(1 for i in items if i[4]) >= len(items) - 2, "covers collected")
    check(data["name"] and data["sid"] == PLAYLIST.rstrip("/").split("/")[-1], f"playlist name and id ({data['name']}, {data['sid']})")

    # Stash in its own context: the userscript only runs on open.spotify.com on the phone.
    st = browser.new_context(**p.devices["iPhone 13"], locale="en-GB").new_page()
    st.goto(f"http://localhost:{PORT}/")
    st.wait_for_selector("html[data-ready='1']")
    st.get_by_role("button", name="Paste from Spotify").click()
    st.wait_for_selector("#sheet .paste-box")
    st.fill("#sheet .paste-box", clip)
    st.get_by_role("button", name="Add playlist").click()
    st.wait_for_selector(".pl-head h1", timeout=8000)
    check(st.locator(".pl-head h1").inner_text() == data["name"], "Stash shows the playlist")
    check(f"0 of {len(items)}" in st.locator(".meter-text").inner_text(), f"Stash lists all {len(items)} songs as still to get")
    st.wait_for_timeout(1500)
    st.screenshot(path=str(out / "t2_in_stash.png"))

print("\nALL PASSED" if not failures else f"\n{len(failures)} FAILED", flush=True)
srv.shutdown()
os._exit(1 if failures else 0)
