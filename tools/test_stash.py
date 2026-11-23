"""End-to-end check of Stash in WebKit emulating an iPhone 13.

Usage: py tools/test_stash.py <outdir>
Serves the app on localhost, pastes a playlist (built here in BetterSpotify's STASH1 format),
adds tagged MP3 / M4A / FLAC / WAV files from test/fixtures, and checks matching, the offline
meter, the missing-song search, playback, lyrics, themes, saving across reloads and offline.
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
FIX = ROOT / "test" / "fixtures"
out = Path(sys.argv[1] if len(sys.argv) > 1 else "test_out")
out.mkdir(parents=True, exist_ok=True)
PORT = 8765

failures = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg, flush=True)
    if not cond:
        failures.append(msg)


def transfer(sid, name, items):
    raw = json.dumps({"v": 1, "sid": sid, "name": name, "cover": "", "items": items}).encode()
    c = zlib.compressobj(9, zlib.DEFLATED, -15)
    data = c.compress(raw) + c.flush()
    return "STASH1:" + base64.urlsafe_b64encode(data).decode().rstrip("=")


ITEMS = [
    ["Never Gonna Give You Up", "Rick Astley", "Whenever You Need Somebody", 213, "ab67616d0000485115ebbedaacef61af244262a8"],
    ["Blinding Lights", "The Weeknd", "After Hours", 200, ""],
    ["COMË N GO", "Yeat", "Dangerous Summer", 198, ""],
    ["A Song Nobody Has", "Someone, Other Person", "Nowhere", 180, ""],
]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://localhost:{PORT}/"

with sync_playwright() as p:
    browser = p.webkit.launch()
    ctx = browser.new_context(**p.devices["iPhone 13"], locale="en-GB", ignore_https_errors=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_selector("html[data-ready='1']", timeout=15000)
    check(page.locator(".steps li").count() == 3, "empty Stash shows the 3 steps")
    page.screenshot(path=str(out / "s1_empty.png"))

    # --- paste a playlist (clipboard read is refused in tests, so the paste box appears)
    page.get_by_role("button", name="Paste from Spotify").click()
    page.wait_for_selector("#sheet .paste-box", timeout=5000)
    page.fill("#sheet .paste-box", "junk")
    page.get_by_role("button", name="Add playlist").click()
    page.wait_for_timeout(300)
    check(page.locator("#sheet .error").is_visible(), "pasting the wrong text explains what to do")
    page.fill("#sheet .paste-box", transfer("37i9test", "Road trip", ITEMS))
    page.get_by_role("button", name="Add playlist").click()
    page.wait_for_selector(".pl-head h1", timeout=5000)
    check(page.locator(".pl-head h1").inner_text() == "Road trip", "pasted playlist opens")
    check("0 of 4" in page.locator(".meter-text").inner_text(), "meter starts at 0 of 4")
    check(page.locator(".missing").count() == 4, "all 4 songs shown as missing")

    # --- add files
    files = [str(FIX / n) for n in ("rick.mp3", "weeknd.m4a", "other.flac", "Yeat - COMË N GO.wav")]
    page.set_input_files("#files", files)
    page.wait_for_function("document.querySelector('#toast').textContent.startsWith('Added')", timeout=30000)
    msg = page.locator("#toast").inner_text()
    print("info:", msg, flush=True)
    check("Added 4 songs" in msg and "3 matched" in msg, f"4 songs added, 3 matched ({msg})")
    check("3 of 4" in page.locator(".meter-text").inner_text(), "meter now 3 of 4")
    check(page.locator(".missing").count() == 1, "1 song still missing")
    page.locator(".missing .row").click()
    sc = page.locator(".missing .find a").first.get_attribute("href")
    check(sc and sc.startswith("https://soundcloud.com/search") and "Someone" in sc, f"missing song gets a SoundCloud search ({sc})")
    page.screenshot(path=str(out / "s2_playlist.png"), full_page=True)

    # --- songs tab: tags read
    page.locator("#tabs button[data-tab='songs']").click()
    titles = page.locator(".songs .row-title").all_inner_texts()
    artists = page.locator(".songs .row-sub").all_inner_texts()
    print("info:", titles, artists, flush=True)
    check("Never Gonna Give You Up" in titles and "Some Other Song" in titles, "MP3 and FLAC titles read from tags")
    check("COMË N GO" in titles and "Yeat" in artists, "WAV title and artist read from the file name")
    check(any("Blinding Lights" in t for t in titles), "M4A title read from tags")
    has_art = page.evaluate("[...document.querySelectorAll('.songs .cover img')].filter(i => i.src.startsWith('blob:')).length")
    check(has_art >= 2, f"cover art read from MP3 and M4A ({has_art})")
    page.screenshot(path=str(out / "s3_songs.png"))

    # --- play the playlist
    page.locator("#tabs button[data-tab='playlists']").click()
    page.locator(".pl-row").first.click()
    page.get_by_role("button", name="Play", exact=True).click()
    page.wait_for_timeout(1500)
    st = page.evaluate("({paused: document.querySelector('#audio').paused, mini: !document.querySelector('#mini').hidden, title: document.querySelector('.mini-title').textContent})")
    print("info:", st, flush=True)
    check(not st["paused"] and st["mini"], "Play starts the playlist and the mini player shows")
    check(st["title"] == "Never Gonna Give You Up", "plays in playlist order")
    # Playwright's Windows WebKit has no MP3/AAC decoder (an iPhone has), so check that sound
    # really advances with the WAV song, reached by skipping twice.
    page.evaluate("document.querySelector('#audio').pause()")
    page.locator("#mini .mini-text").click()
    page.wait_for_selector("#np:not([hidden])")
    for _ in range(30):
        if page.locator("#np .ly").count() > 5:
            break
        page.wait_for_timeout(500)
    n_ly = page.locator("#np .ly").count()
    check(n_ly > 5, f"synced lyrics loaded from LRCLIB ({n_ly} lines)")
    page.screenshot(path=str(out / "s4_now_playing.png"))
    page.get_by_role("button", name="Next").click()
    page.wait_for_timeout(1500)
    check(page.locator(".np-title").inner_text().startswith("Blinding Lights"), "Next plays the next song")
    page.get_by_role("button", name="Next").click()
    page.wait_for_timeout(2500)
    # Playwright's Windows WebKit can't decode local audio at all (it crashes even without
    # Stash), so real playback is checked in the Chromium part below.
    check(page.locator(".np-title").inner_text() == "COMË N GO", "Next again reaches the third song")
    page.screenshot(path=str(out / "s4b_now_playing_wav.png"))
    page.get_by_role("button", name="Close").click()

    # --- theme
    page.locator("#tabs button[data-tab='settings']").click()
    page.locator(".theme", has_text="Sunset").click()
    bg = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()")
    check(bg == "#160c12", f"Sunset theme applies ({bg})")
    page.screenshot(path=str(out / "s5_settings.png"))

    # --- saved across a reload
    page.reload()
    page.wait_for_selector("html[data-ready='1']")
    pl_sub = page.locator(".pl-row .row-sub").first.inner_text()
    check("3 of 4" in pl_sub, f"playlist and songs kept after reload ({pl_sub})")
    bg = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()")
    check(bg == "#160c12", "theme kept after reload")
    lyr = page.evaluate("window.__stash.S.tracks.size")
    check(lyr == 4, "4 songs kept after reload")

    check(not errors, f"no page errors {errors[:3]}")

    # --- offline. Playwright's WebKit crashes reloading offline, so this part uses Chromium
    # (the service worker is standard code; Safari runs the same).
    cb = p.chromium.launch()
    cctx = cb.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    cp = cctx.new_page()
    cerr = []
    cp.on("pageerror", lambda e: cerr.append(str(e)))
    cp.goto(URL)
    cp.wait_for_selector("html[data-ready='1']")
    cp.evaluate("navigator.serviceWorker.ready")
    cp.reload()  # now controlled by the service worker
    cp.wait_for_selector("html[data-ready='1']")
    cp.get_by_role("button", name="Paste from Spotify").click()
    cp.wait_for_selector("#sheet .paste-box")
    cp.fill("#sheet .paste-box", transfer("37i9test", "Road trip", ITEMS))
    cp.get_by_role("button", name="Add playlist").click()
    cp.set_input_files("#files", [str(FIX / "Yeat - COMË N GO.wav")])
    cp.wait_for_function("document.querySelector('#toast').textContent.startsWith('Added')", timeout=20000)
    cctx.set_offline(True)
    cp.reload()
    ok = cp.wait_for_selector("html[data-ready='1']", timeout=8000) is not None
    check(ok and "1 of 4" in cp.locator(".pl-row .row-sub").first.inner_text(), "opens with no internet and shows playlists")
    cp.locator(".pl-row").first.click()
    cp.get_by_role("button", name="Play", exact=True).click()
    cp.wait_for_timeout(2500)
    ct = cp.evaluate("document.querySelector('#audio').currentTime")
    check(ct > 0.8, f"plays a song with no internet ({ct:.1f}s in)")
    ms = cp.evaluate("navigator.mediaSession.metadata && [navigator.mediaSession.metadata.title, navigator.mediaSession.metadata.artist]")
    check(ms == ["COMË N GO", "Yeat"], f"lock-screen info set ({ms})")
    cp.screenshot(path=str(out / "s6_offline.png"))
    check(not cerr, f"no page errors offline {cerr[:3]}")

print("\nALL PASSED" if not failures else f"\n{len(failures)} FAILED", flush=True)
srv.shutdown()
os._exit(1 if failures else 0)
