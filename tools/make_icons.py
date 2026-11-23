"""Render icons/icon.svg to the PNG sizes iPhone wants. Usage: py tools/make_icons.py"""

import os
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
svg = (ROOT / "icons" / "icon.svg").read_text(encoding="utf-8")
with sync_playwright() as p:
    b = p.chromium.launch()
    for size in (180, 512):
        pg = b.new_page(viewport={"width": size, "height": size})
        pg.set_content(f"<html><body style='margin:0'>{svg.replace('<svg ', f'<svg width={size} height={size} ', 1)}</body></html>")
        pg.screenshot(path=str(ROOT / "icons" / f"icon-{size}.png"))
        print("wrote", size, flush=True)
os._exit(0)
