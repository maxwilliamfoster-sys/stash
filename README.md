# Stash

An offline music player for the iPhone that you add to the home screen from Safari. It is a
sister app to `../BetterSpotify-Safari` and costs £0: plain HTML, CSS and JS, with no build step
and no server. Songs, playlists and lyrics stay on the phone.

## What it does
- **Paste from Spotify**: in BetterSpotify (v0.5.0+, Full mode), tap **Add to Stash** on a
  playlist or Liked Songs, or tap **⋯** on any song and choose **Add to Stash**. Then, in
  Stash, tap **Paste from Spotify**. A playlist arrives with its song names, order and covers,
  but no audio. Single songs go into "Added from Spotify". BetterSpotify remembers every song
  you've added, so one Paste brings in all of them, and Stash skips songs it already has.
- **Add songs**: pick audio files from the Files app (MP3, M4A/AAC, FLAC, WAV, ...). Stash
  reads their tags (or the file name, such as "Artist - Title") and puts each song into every
  playlist it belongs to.
- **Offline meter**: each playlist shows how much of it is offline, for example "12 of 50
  songs offline". Missing songs have a **Find** button that searches SoundCloud and Bandcamp,
  where many songs are free to download legally.
- **Player**: shuffle, repeat, play next, lock-screen controls (Media Session), and synced
  lyrics from LRCLIB that are saved for offline use.
- Your own playlists too. Themes: Midnight, Sunset, OLED Black, Glass (the same as
  BetterSpotify).

Stash never downloads or decrypts Spotify audio. You get the files yourself, legally.

Live: https://maxwilliamfoster-sys.github.io/stash/ (GitHub Pages, repo `maxwilliamfoster-sys/stash`).

## Install on the iPhone
1. Open https://maxwilliamfoster-sys.github.io/stash/ in **Safari**.
2. Share › **Add to Home Screen** › Add.
3. Open Stash from the home-screen icon. Home-screen apps keep their own storage, separate from
   Safari, which is why playlists come across through the clipboard.

## Develop
- Run it locally with `py -m http.server 8000` in this folder, then open http://localhost:8000.
- `py tools/test_stash.py <outdir>` runs 27 checks in Playwright: the WebKit iPhone 13 UI flow,
  plus offline open and playback in Chromium (Windows WebKit can't decode local audio).
- `py tools/test_send_to_stash.py <outdir>` tests BetterSpotify's Send to Stash end to end
  with Stash Paste. It needs `../BetterSpotify-Safari/dist/betterspotify.user.js`.
- Icons: `py tools/make_icons.py`. Test files are in `test/fixtures/`.
- When you change files, bump `VERSION` in `sw.js` so phones pick up the new version.

The design, data model and progress log are in `PROGRESS.md`.
