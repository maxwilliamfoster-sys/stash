# Stash: design and progress

Offline music player for Max's iPhone, added to the home screen from Safari. Sister app to
`../BetterSpotify-Safari`. Costs £0: plain HTML/CSS/JS, no build step, hosted on GitHub Pages
(only once Max agrees to publish).

## Why
Spotify's free web player can't play offline, and its audio is DRM-encrypted (copying it is
not legal, so we don't). Max wants offline playlists that are easy to set up. So: Spotify
provides the playlist (names, order, covers); Max gets the actual song files legally (free
downloads on SoundCloud/Bandcamp, music he owns); Stash files each song into every playlist it
belongs to and plays it all offline.

## Goals
- BetterSpotify "Send to Stash" button on a Spotify playlist / Liked Songs page copies the
  playlist; Stash "Paste from Spotify" imports it (clipboard, because home-screen apps have
  storage separate from Safari).
- Playlists show what's offline vs missing (the offline meter); missing songs get one-tap
  SoundCloud / Bandcamp searches.
- "Add songs" picks files from the Files app; Stash reads the tags (MP3 ID3, M4A, FLAC, else
  the file name) and matches them to playlist entries automatically.
- Own playlists too. Plays fully offline: lock-screen controls (Media Session), shuffle,
  repeat, synced lyrics fetched from LRCLIB while online and stored for offline.
- Same 4 themes as BetterSpotify (Midnight default).

## Non-goals / anti-goals
- Never download or decrypt Spotify (or YouTube) audio. No Spotify API (needs Premium).
- No accounts, no server, no cost. Songs never leave the phone.

## Design (frontend-design pass)
- Colours: BetterSpotify theme values (Midnight bg #0b0d17, hi #181c30, accent #9d8cff).
- Type: `ui-rounded` (SF Pro Rounded on iPhone) for headings and numbers, system SF for text.
- The one bold element: the offline meter (ring on playlist covers, bar in playlist header,
  dashed empty slots for missing songs). Everything else quiet and left aligned.
- Layout: views Playlists / Songs / Settings in a bottom tab bar; mini player above it; Now
  Playing as a full-screen sheet with lyrics under the controls.

## Data (IndexedDB "stash")
- tracks: {id, title, artist, album, duration, audio Blob, art Blob|null, key, addedAt, lyrics}
- playlists: {id, name, source 'spotify'|'local', sid, cover, items:[{title, artist, album,
  duration, art, key, trackId|null}], updatedAt}
- Transfer text: `STASH1:` + base64url(deflate-raw(JSON {v, sid, name, cover, items:[[title,
  artists, album, seconds, artId]]})).

## Progress
- 2026-11-23: design agreed with Max ("go ahead with the build"). Checked: LRCLIB and
  i.scdn.co both send `Access-Control-Allow-Origin: *`. Spotify desktop tracklist: rows
  `[data-testid=tracklist-row]` inside `[aria-rowindex]`, title `a[data-testid=internal-track-link]`,
  artists `a[href^="/artist/"]`, album `a[href^="/album/"]`, duration = last gridcell text
  m:ss, art img `ab67616d00004851<id>` (64px). List is virtualised: scroll
  `#main-view [data-overlayscrollbars-viewport]` to collect all; count from the grid's
  `aria-rowcount`.
- 2026-11-23: Stash app built (index.html, css/app.css, js/{app,db,tags,match}.js, sw.js, manifest,
  icons). tools/test_stash.py 27/27: paste import, tag reading (MP3/M4A/FLAC/WAV name), matching
  (3 of 4), missing-song search, playback order, LRCLIB lyrics, themes, reload persistence;
  offline open + play checked in Chromium. LESSONS: Playwright's Windows WebKit can't decode
  local audio at all (crashes) and crashes reloading offline -> use Chromium for those; WebKit
  (like Safari Private mode) refuses Blobs in IndexedDB -> songs stored as ArrayBuffers.
  Next: BetterSpotify "Send to Stash" button, docs, ask Max before publishing to GitHub Pages.
- 2026-11-23: BetterSpotify v0.4.0 "Send to Stash" pill in the playlist action bar (playlists +
  Liked Songs, Full mode only). Scrolls the virtualised list to collect every row, copies
  `STASH1:` text with one tap (ClipboardItem with a promise keeps the tap's permission while it
  collects); if Safari refuses, the button turns into "Tap to copy for Stash" for a second tap.
  tools/test_send_to_stash.py (WebKit iPhone 13, signed out, Today's Top Hits): 50/50 songs with
  title, artist, length and cover, pasted into Stash = "0 of 50 songs offline". ALL PASSED.
  Not yet checked on the real iPhone: clipboard, Files import, lock screen, storage persistence.
  Next: Max agrees to publish -> GitHub Pages, then guide him through install one step at a time.
- 2026-11-23: Max said "Yes, publish it". Public repo maxwilliamfoster-sys/stash, Pages from main /
  -> https://maxwilliamfoster-sys.github.io/stash/ . Live check at 390x844: app renders, service
  worker active (scope /stash/), icons + manifest 200, no console errors. Next: install on the iPhone.
- 2026-11-23: Stash icon is on Max's home screen. He asked to pick a song on Spotify and "add to
  stash". BetterSpotify v0.5.0: every song's ⋯ button is shown on the phone (it is hover-only on
  desktop), and its menu (`#context-menu ul[role=menu]`, cloned from Spotify's own first row)
  gets "Add to Stash". The song goes into a basket in localStorage (max 500), and the whole basket
  is copied as `STASH0:` + base64url(JSON {v:1, sid:'spotify-adds', name:'Added from Spotify',
  add:true, items}). It's uncompressed so the copy happens right inside the tap. Stash 1.1.0
  decodes STASH0/1; `add` merges new songs only. The playlist button was renamed "Add to Stash".
  test_send_to_stash.py 18/18, test_stash.py 27/27, BSP test_full + test_iphone all pass.
- 2026-11-23: Max's real signed-in iPhone. The song menu showed no item, so BSP 0.5.2 made it
  layout-proof and added a backup bar. Then "it doesn't add it to stash", and the playlist button
  said "Couldn't read this playlist". Fixes:
  - BSP 0.5.3: the collector starts from the first tracklist-row and no longer needs the grid's
    role/aria-rowcount. The count comes from "N songs" text, and the error shows its reason.
  - Stash 1.1.1: the SW is network-first (3s timeout, then cache). Before, it was cache-first, so
    a home-screen Stash opened at 1.0.0 kept running old code that rejects STASH0. A new SW
    reloads the app once if nothing is playing. Checked live: the old 1.1.0 tab updated itself to
    1.1.1. test_send_to_stash.py 22/22 (incl. no-rowcount), test_stash.py 27/27.
