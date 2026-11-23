import { db, uid } from './db.js';
import { readTags } from './tags.js';
import { sameSong, normTitle, decodeTransfer, findLyrics } from './match.js';

const VERSION = '1.1.1';

/* ------------------------------------------------------------------ themes */
// Same colours as BetterSpotify (../BetterSpotify-Safari/src/themes.json).
const THEMES = {
  midnight: { name: 'Midnight', bg: '#0b0d17', hi: '#181c30', hi2: '#232842', press: '#05060c', text: '#ffffff', muted: '#aab0cc', muted2: '#6e7494', accent: '#9d8cff', accentHi: '#b4a7ff', onAccent: '#0b0d17' },
  sunset: { name: 'Sunset', bg: '#160c12', hi: '#2a1720', hi2: '#38202b', press: '#0b0509', text: '#fff6f2', muted: '#cfaeb0', muted2: '#8f6f74', accent: '#ff7a59', accentHi: '#ff9476', onAccent: '#160c12' },
  oled: { name: 'OLED Black', bg: '#000000', hi: '#121212', hi2: '#1c1c1c', press: '#000000', text: '#ffffff', muted: '#a0a0a0', muted2: '#6a6a6a', accent: '#1ed760', accentHi: '#3be477', onAccent: '#000000' },
  glass: { name: 'Glass', glass: true, bg: '#0c0c10', hi: 'rgba(255,255,255,0.10)', hi2: 'rgba(255,255,255,0.16)', press: 'rgba(0,0,0,0.3)', text: '#ffffff', muted: '#c8c8d0', muted2: '#8a8a94', accent: '#1ed760', accentHi: '#3be477', onAccent: '#000000' },
};

/* ------------------------------------------------------------------- state */
const S = {
  tracks: new Map(), // id -> track without the audio Blob
  playlists: [],
  settings: { theme: 'midnight' },
  view: { name: 'playlists' },
  history: [],
  queue: [],
  qi: -1,
  shuffle: false,
  repeat: 'off', // off | all | one
  missingOnly: false,
  songFilter: '',
};

const $ = (s, el = document) => el.querySelector(s);
const audio = $('#audio');
const viewEl = $('#view');

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const ICONS = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l11-6.5a1 1 0 0 0 0-1.72l-11-6.5A1 1 0 0 0 8 5.5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 6.2v11.6a1 1 0 0 0 1.53.85l8.6-5.8a1 1 0 0 0 0-1.7l-8.6-5.8A1 1 0 0 0 5 6.2Z"/><rect x="16.5" y="5" width="2.8" height="14" rx="1.2"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M19 6.2v11.6a1 1 0 0 1-1.53.85l-8.6-5.8a1 1 0 0 1 0-1.7l8.6-5.8A1 1 0 0 1 19 6.2Z"/><rect x="4.7" y="5" width="2.8" height="14" rx="1.2"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6C14.3 16 15.5 17 17.5 17H21M18 14l3 3-3 3M3 17h3.5c1.3 0 2.2-.4 3-1.1M14.5 8.1c.8-.7 1.7-1.1 3-1.1H21M18 4l3 3-3 3"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2.5l3 3-3 3M4 11.5v-1a5 5 0 0 1 5-5h11M7 21.5l-3-3 3-3M20 12.5v1a5 5 0 0 1-5 5H4"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  playlists: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h12M4 11h12M4 16h7"/><path d="M17 14.5v-6l4-1" stroke-linejoin="round"/><circle cx="15" cy="17" r="2.5"/></svg>',
  songs: '<svg viewBox="0 0 24 24"><path d="M19.5 3.6a1 1 0 0 0-1.2-.98l-8.5 1.7a1 1 0 0 0-.8.98v9.27A3.4 3.4 0 1 0 11 17.6V9.1l6.5-1.3v4.77a3.4 3.4 0 1 0 2 3.03V3.6Z"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></svg>',
  paste: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="17" rx="2.5"/><path d="M9.5 4V3h5v1M12 9v7M9 13l3 3 3-3"/></svg>',
  add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
};
const icon = (name, cls) => h('span', { class: 'ico' + (cls ? ' ' + cls : ''), html: ICONS[name], 'aria-hidden': 'true' });

/* -------------------------------------------------------------------- boot */
async function boot() {
  const saved = await db.get('settings', 'settings').catch(() => null);
  if (saved) Object.assign(S.settings, saved);
  applyTheme();
  for (const t of await db.trackSummaries()) S.tracks.set(t.id, t);
  S.playlists = await db.all('playlists');
  sortPlaylists();
  buildChrome();
  render();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    // A newer Stash took over: reload once to run it, unless music is playing.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && audio.paused && !sessionStorage.getItem('stash-reloaded')) {
        sessionStorage.setItem('stash-reloaded', '1');
        location.reload();
      }
    });
    navigator.serviceWorker.register('sw.js').then((r) => r.update()).catch(() => {});
  }
  window.addEventListener('online', () => lyricsQueue.kick());
  lyricsQueue.kick();
  window.__stash = { S, importTransferText, addFiles }; // for tests
  document.documentElement.dataset.ready = '1';
}

function sortPlaylists() {
  S.playlists.sort((a, b) => (a.sid === 'liked' ? -1 : b.sid === 'liked' ? 1 : (b.updatedAt || 0) - (a.updatedAt || 0)));
}

const saveSettings = () => db.put('settings', S.settings, 'settings');

function applyTheme() {
  const t = THEMES[S.settings.theme] || THEMES.midnight;
  const r = document.documentElement.style;
  const map = { bg: t.bg, hi: t.hi, hi2: t.hi2, press: t.press, text: t.text, muted: t.muted, muted2: t.muted2, accent: t.accent, 'accent-hi': t.accentHi, 'on-accent': t.onAccent };
  for (const [k, v] of Object.entries(map)) r.setProperty('--' + k, v);
  document.documentElement.classList.toggle('glass', !!t.glass);
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = t.bg;
}

/* ------------------------------------------------------------------ chrome */
function buildChrome() {
  const tabs = $('#tabs');
  tabs.replaceChildren(
    ...[
      ['playlists', 'Playlists'],
      ['songs', 'Songs'],
      ['settings', 'Settings'],
    ].map(([k, label]) => h('button', { type: 'button', 'data-tab': k, onclick: () => go({ name: k }, true) }, icon(k), h('span', null, label)))
  );
  $('#mini').addEventListener('click', (e) => {
    if (e.target.closest('.mini-play')) return;
    openNowPlaying();
  });
  $('#mini .mini-play').addEventListener('click', () => togglePlay());
  $('#files').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) await addFiles(files);
  });
  buildNowPlaying();
}

function go(view, root) {
  if (root) S.history = [];
  else S.history.push(S.view);
  S.view = view;
  render();
  viewEl.scrollTop = 0;
  window.scrollTo(0, 0);
}

function back() {
  S.view = S.history.pop() || { name: 'playlists' };
  render();
}

function render() {
  const v = S.view;
  document.querySelectorAll('#tabs button').forEach((b) => {
    const on = b.dataset.tab === v.name || (v.name === 'playlist' && b.dataset.tab === 'playlists');
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  const out = v.name === 'playlist' ? renderPlaylist(v.id) : v.name === 'songs' ? renderSongs() : v.name === 'settings' ? renderSettings() : renderPlaylists();
  viewEl.replaceChildren(out);
  updateMini();
}

/* ------------------------------------------------------------------- art */
const artUrls = new Map();
function artFor(t) {
  if (!t) return '';
  if (t.art && t.art.buf) {
    if (!artUrls.has(t.id)) artUrls.set(t.id, URL.createObjectURL(new Blob([t.art.buf], { type: t.art.type || 'image/jpeg' })));
    return artUrls.get(t.id);
  }
  return t.artUrl || '';
}

function cover(src, cls, label) {
  const el = h('div', { class: 'cover ' + (cls || '') });
  if (src) el.append(h('img', { src, alt: '', loading: 'lazy', decoding: 'async', onerror: (e) => e.target.remove() }));
  else el.append(h('span', { class: 'cover-letter' }, (label || '?').trim().charAt(0).toUpperCase()));
  return el;
}

/* -------------------------------------------------------------- playlists */
const owned = (pl) => pl.items.filter((it) => it.trackId && S.tracks.has(it.trackId));

function meterRing(have, total) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const f = total ? have / total : 0;
  return h('span', {
    class: 'ring' + (total && have === total ? ' full' : ''),
    'aria-hidden': 'true',
    html: `<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="${r}" class="ring-bg"/><circle cx="18" cy="18" r="${r}" class="ring-fg" stroke-dasharray="${(f * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 18 18)"/></svg>`,
  });
}

function renderPlaylists() {
  const wrap = h('div', { class: 'page' });
  wrap.append(h('header', { class: 'page-head' }, h('h1', null, 'Stash')));
  if (!navigator.standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    wrap.append(
      h(
        'div',
        { class: 'note' },
        h('strong', null, 'Add Stash to your Home Screen'),
        h('p', null, 'Tap Share, then Add to Home Screen, and open Stash from there. Songs added in a Safari tab stay in that tab, and Safari can clear them.')
      )
    );
  }
  wrap.append(
    h(
      'div',
      { class: 'actions' },
      h('button', { type: 'button', class: 'btn primary', onclick: pasteFromSpotify }, icon('paste'), 'Paste from Spotify'),
      h('button', { type: 'button', class: 'btn', onclick: () => $('#files').click() }, icon('add'), 'Add songs')
    )
  );
  if (!S.playlists.length) {
    wrap.append(
      h(
        'ol',
        { class: 'steps' },
        h('li', null, h('strong', null, 'Copy a playlist. '), 'In Spotify (Safari), tap Add to Stash on a playlist or Liked Songs, or tap ⋯ on any song and choose Add to Stash.'),
        h('li', null, h('strong', null, 'Paste it here. '), 'Tap Paste from Spotify. You’ll see which songs you still need.'),
        h('li', null, h('strong', null, 'Add the songs. '), 'Download them (free on SoundCloud or Bandcamp), then tap Add songs. Stash puts each one in the right playlists.')
      )
    );
  }
  const list = h('ul', { class: 'list' });
  for (const pl of S.playlists) {
    const have = owned(pl).length;
    const total = pl.items.length;
    const firstArt = pl.cover || artFor(S.tracks.get((owned(pl)[0] || {}).trackId)) || '';
    list.append(
      h(
        'li',
        null,
        h(
          'button',
          { type: 'button', class: 'row pl-row', onclick: () => go({ name: 'playlist', id: pl.id }) },
          h('div', { class: 'cover-wrap' }, pl.sid === 'liked' ? h('div', { class: 'cover liked', html: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.4-7.5-10.1A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8c0 5.7-7.5 10.1-7.5 10.1Z"/></svg>' }) : cover(firstArt, '', pl.name), pl.source === 'spotify' ? meterRing(have, total) : null),
          h('div', { class: 'row-text' }, h('span', { class: 'row-title' }, pl.name), h('span', { class: 'row-sub' }, pl.source === 'spotify' ? `${have} of ${total} offline` : `${total} song${total === 1 ? '' : 's'}`))
        )
      )
    );
  }
  list.append(h('li', null, h('button', { type: 'button', class: 'row new-row', onclick: newPlaylist }, h('div', { class: 'cover dashed' }, icon('add')), h('div', { class: 'row-text' }, h('span', { class: 'row-title' }, 'New playlist')))));
  wrap.append(list);
  return wrap;
}

function renderPlaylist(id) {
  const pl = S.playlists.find((p) => p.id === id);
  if (!pl) return renderPlaylists();
  const own = owned(pl);
  const total = pl.items.length;
  const wrap = h('div', { class: 'page' });
  wrap.append(h('button', { type: 'button', class: 'icon-btn back', 'aria-label': 'Back', onclick: back }, icon('back')));
  const art = pl.sid === 'liked' ? h('div', { class: 'cover big liked', html: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.4-7.5-10.1A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8c0 5.7-7.5 10.1-7.5 10.1Z"/></svg>' }) : cover(pl.cover || artFor(S.tracks.get((own[0] || {}).trackId)), 'big', pl.name);
  const head = h('header', { class: 'pl-head' }, art, h('h1', null, pl.name));
  if (pl.source === 'spotify') {
    const pct = total ? Math.round((own.length / total) * 100) : 0;
    head.append(
      h('div', { class: 'meter', role: 'img', 'aria-label': `${own.length} of ${total} songs offline` }, h('div', { class: 'meter-fill', style: `width:${pct}%` })),
      h('p', { class: 'meter-text' }, h('strong', null, `${own.length} of ${total}`), own.length === total && total ? ' songs offline. All set.' : ' songs offline')
    );
  } else head.append(h('p', { class: 'meter-text' }, `${total} song${total === 1 ? '' : 's'}`));
  const playOrder = () => own.map((it) => it.trackId);
  head.append(
    h(
      'div',
      { class: 'pl-actions' },
      h('button', { type: 'button', class: 'btn primary round', disabled: !own.length, onclick: () => playIds(playOrder(), 0, false) }, icon('play'), 'Play'),
      h('button', { type: 'button', class: 'btn round', disabled: !own.length, onclick: () => playIds(playOrder(), 0, true) }, icon('shuffle'), 'Shuffle'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Playlist options', onclick: () => playlistMenu(pl) }, icon('more'))
    )
  );
  wrap.append(head);
  if (pl.source === 'spotify' && own.length < total) {
    wrap.append(
      h(
        'label',
        { class: 'toggle-row' },
        h('span', null, 'Show only missing songs'),
        h('input', {
          type: 'checkbox',
          role: 'switch',
          class: 'switch',
          checked: S.missingOnly,
          onchange: (e) => {
            S.missingOnly = e.target.checked;
            render();
          },
        })
      )
    );
  }
  const list = h('ul', { class: 'list songs' });
  pl.items.forEach((it, i) => {
    const t = it.trackId && S.tracks.get(it.trackId);
    if (t && S.missingOnly && pl.source === 'spotify') return;
    if (t) {
      const idx = own.indexOf(it);
      list.append(h('li', null, songRow(t, () => playIds(playOrder(), idx, false), it.art)));
    } else {
      list.append(missingRow(it));
    }
  });
  if (pl.source === 'local') list.append(h('li', null, h('button', { type: 'button', class: 'row new-row', onclick: () => pickSongsFor(pl) }, h('div', { class: 'cover dashed small' }, icon('add')), h('div', { class: 'row-text' }, h('span', { class: 'row-title' }, 'Add songs to this playlist')))));
  wrap.append(list);
  if (pl.source === 'spotify') wrap.append(h('p', { class: 'fine' }, pl.sid === 'spotify-adds'
    ? 'Songs you add from a song’s ⋯ menu in Spotify land here. Add more there, then Paste from Spotify.'
    : 'Changed this playlist on Spotify? Tap Add to Stash there again, then Paste from Spotify. Songs you already have stay put.'));
  return wrap;
}

function songRow(t, onPlay, fallbackArt) {
  const playing = S.queue[S.qi] === t.id;
  return h(
    'div',
    { class: 'row song' + (playing ? ' now' : '') },
    h('button', { type: 'button', class: 'song-main', onclick: onPlay }, cover(artFor(t) || fallbackArt || '', 'small', t.title), h('div', { class: 'row-text' }, h('span', { class: 'row-title' }, t.title), h('span', { class: 'row-sub' }, t.artist || 'Unknown artist'))),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Options for ${t.title}`, onclick: () => songMenu(t) }, icon('more'))
  );
}

function missingRow(it) {
  const q = encodeURIComponent(`${it.artist.split(',')[0]} ${it.title.replace(/\s*[([].*?[)\]]/g, '')}`.trim());
  const links = h(
    'div',
    { class: 'find', hidden: true },
    h('a', { class: 'chip', href: `https://soundcloud.com/search/sounds?q=${q}`, target: '_blank', rel: 'noopener' }, 'Search SoundCloud'),
    h('a', { class: 'chip', href: `https://bandcamp.com/search?q=${q}&item_type=t`, target: '_blank', rel: 'noopener' }, 'Search Bandcamp')
  );
  return h(
    'li',
    { class: 'missing' },
    h(
      'button',
      { type: 'button', class: 'row song', 'aria-expanded': 'false', onclick: (e) => { links.hidden = !links.hidden; e.currentTarget.setAttribute('aria-expanded', String(!links.hidden)); } },
      h('div', { class: 'cover small dashed' }, it.art ? h('img', { src: it.art, alt: '', loading: 'lazy' }) : null),
      h('div', { class: 'row-text' }, h('span', { class: 'row-title' }, it.title), h('span', { class: 'row-sub' }, it.artist)),
      h('span', { class: 'need' }, 'Find')
    ),
    links
  );
}

/* ------------------------------------------------------------------ songs */
function renderSongs() {
  const wrap = h('div', { class: 'page' });
  const all = [...S.tracks.values()].sort((a, b) => a.title.localeCompare(b.title));
  wrap.append(h('header', { class: 'page-head' }, h('h1', null, 'Songs'), h('p', { class: 'head-sub' }, `${all.length} on this phone`)));
  wrap.append(h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onclick: () => $('#files').click() }, icon('add'), 'Add songs'), all.length ? h('button', { type: 'button', class: 'btn', onclick: () => playIds(all.map((t) => t.id), 0, true) }, icon('shuffle'), 'Shuffle all') : null));
  if (!all.length) {
    wrap.append(h('p', { class: 'empty' }, 'No songs yet. Tap Add songs and pick music files from the Files app. MP3, M4A, AAC, FLAC and WAV all work.'));
    return wrap;
  }
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search your songs', value: S.songFilter, 'aria-label': 'Search your songs' });
  const list = h('ul', { class: 'list songs' });
  const fill = () => {
    const q = normTitle(search.value);
    S.songFilter = search.value;
    const shown = all.filter((t) => !q || normTitle(t.title + ' ' + t.artist + ' ' + t.album).includes(q));
    list.replaceChildren(...shown.map((t, i) => h('li', null, songRow(t, () => playIds(shown.map((x) => x.id), i, false)))));
  };
  search.addEventListener('input', fill);
  fill();
  wrap.append(search, list);
  return wrap;
}

/* --------------------------------------------------------------- settings */
function renderSettings() {
  const wrap = h('div', { class: 'page' });
  wrap.append(h('header', { class: 'page-head' }, h('h1', null, 'Settings')));
  wrap.append(h('h2', null, 'Theme'));
  const grid = h('div', { class: 'themes' });
  for (const [key, t] of Object.entries(THEMES)) {
    grid.append(
      h(
        'button',
        {
          type: 'button',
          class: 'theme',
          'aria-pressed': String(S.settings.theme === key),
          onclick: () => {
            S.settings.theme = key;
            saveSettings();
            applyTheme();
            render();
          },
        },
        h('span', { class: 'swatch', style: `background:${t.glass ? 'linear-gradient(135deg,#3a2a5a,#0c0c10 60%,#16402c)' : t.bg};box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)` }, h('i', { style: `background:${t.accent}` })),
        h('span', null, t.name)
      )
    );
  }
  wrap.append(grid);
  wrap.append(h('h2', null, 'Storage'));
  const storage = h('p', { class: 'body' }, 'Checking…');
  wrap.append(storage);
  (async () => {
    const used = [...S.tracks.values()].reduce((n, t) => n + (t.size || 0), 0);
    let text = `${S.tracks.size} song${S.tracks.size === 1 ? '' : 's'} using ${mb(used)}.`;
    try {
      const est = await navigator.storage.estimate();
      if (est.quota) text += ` About ${mb(Math.max(0, est.quota - est.usage))} free for Stash.`;
      const kept = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      text += kept ? ' Your phone will keep these songs.' : navigator.standalone ? '' : ' Open Stash from your Home Screen so iPhone keeps them.';
    } catch (e) {
      /* estimate not supported */
    }
    storage.textContent = text;
  })();
  const missingLyrics = [...S.tracks.values()].filter((t) => !t.lyrics).length;
  wrap.append(h('h2', null, 'Lyrics'));
  wrap.append(h('p', { class: 'body' }, missingLyrics ? `${missingLyrics} song${missingLyrics === 1 ? '' : 's'} still need lyrics. They download from LRCLIB whenever you’re online.` : 'Lyrics are saved for all your songs, so they work offline.'));
  if (missingLyrics) wrap.append(h('button', { type: 'button', class: 'btn', onclick: () => { lyricsQueue.kick(true); toast('Getting lyrics…'); } }, 'Get lyrics now'));
  wrap.append(h('h2', null, 'About'));
  wrap.append(h('p', { class: 'body' }, `Stash ${VERSION}. Your songs stay on this phone and never upload anywhere. Playlists come from BetterSpotify’s Add to Stash button. Lyrics from LRCLIB.`));
  return wrap;
}

const mb = (n) => (n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(0, Math.round(n / 1e6)) + ' MB');

/* ------------------------------------------------------------ adding songs */
async function addFiles(files) {
  const added = [];
  let skipped = 0;
  let failed = '';
  const audioFiles = files.filter((f) => /^audio\//.test(f.type) || /\.(mp3|m4a|aac|flac|wav|ogg|opus|aiff?|caf)$/i.test(f.name));
  skipped += files.length - audioFiles.length;
  for (let i = 0; i < audioFiles.length; i++) {
    const f = audioFiles[i];
    toast(`Adding ${i + 1} of ${audioFiles.length}…`, true);
    const tags = await readTags(f);
    const dupe = [...S.tracks.values()].find((t) => t.size === f.size && t.title === tags.title && t.artist === tags.artist);
    if (dupe) {
      skipped++;
      continue;
    }
    const duration = await probeDuration(f);
    // Stored as plain bytes: Safari can refuse File/Blob objects in IndexedDB (e.g. Private mode).
    const art = tags.art ? { buf: await tags.art.arrayBuffer(), type: tags.art.type } : null;
    const track = { id: uid(), title: tags.title, artist: tags.artist, album: tags.album, duration, art, artUrl: '', audio: await f.arrayBuffer(), type: f.type || guessType(f.name), addedAt: Date.now(), lyrics: null };
    try {
      await db.put('tracks', track);
    } catch (e) {
      failed = `Couldn’t save ${f.name}: ${e && e.name === 'QuotaExceededError' ? 'your phone is out of space for Stash' : (e && e.message) || 'storage error'}.`;
      break;
    }
    const { audio: _a, ...summary } = track;
    summary.size = f.size;
    S.tracks.set(track.id, summary);
    added.push(summary);
  }
  if (added.length && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const linked = await relinkAll(added);
  render();
  let msg = added.length ? `Added ${added.length} song${added.length === 1 ? '' : 's'}.` : 'No new songs added.';
  if (added.length) msg += linked ? ` ${linked} matched your playlists.` : ' None matched a playlist yet.';
  if (skipped) msg += ` Skipped ${skipped} (already added or not music).`;
  if (failed) msg = failed + (added.length ? ` ${added.length} added before that.` : '');
  toast(msg);
  lyricsQueue.kick();
  return { added: added.length, linked, skipped };
}

function guessType(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg' }[ext] || 'audio/mpeg';
}

function probeDuration(file) {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = (d) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) ? d : 0);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    setTimeout(() => done(a.duration), 6000);
    a.src = url;
  });
}

// Link playlist entries to songs on the phone. Returns how many entries got a song.
async function relinkAll(newTracks) {
  const candidates = newTracks && newTracks.length ? newTracks : [...S.tracks.values()];
  let count = 0;
  for (const pl of S.playlists) {
    if (pl.source !== 'spotify') continue;
    let changed = false;
    for (const it of pl.items) {
      if (it.trackId && S.tracks.has(it.trackId)) continue;
      const t = candidates.find((c) => sameSong(c, it));
      if (t) {
        it.trackId = t.id;
        changed = true;
        count++;
        if (!t.art && !t.artUrl && it.art) await setTrackField(t.id, { artUrl: it.art });
      }
    }
    if (changed) await db.put('playlists', pl);
  }
  return count;
}

async function setTrackField(id, fields) {
  const full = await db.get('tracks', id);
  if (!full) return;
  Object.assign(full, fields);
  await db.put('tracks', full);
  const s = S.tracks.get(id);
  if (s) Object.assign(s, fields);
}

/* --------------------------------------------------- playlists from Spotify */
async function pasteFromSpotify() {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    text = '';
  }
  if (text && /STASH[01]:/.test(text)) return importTransferText(text);
  pasteSheet();
}

function pasteSheet() {
  const area = h('textarea', { class: 'paste-box', rows: 4, placeholder: 'Press and hold here, then tap Paste', 'aria-label': 'Copied playlist' });
  const err = h('p', { class: 'error', hidden: true });
  sheet(
    h('h2', null, 'Paste your playlist'),
    h('p', { class: 'body' }, 'In Spotify (Safari), tap Add to Stash on a playlist, or tap ⋯ on a song and choose Add to Stash. Then come back here and paste.'),
    area,
    err,
    h('button', {
      type: 'button',
      class: 'btn primary wide',
      onclick: async () => {
        try {
          await importTransferText(area.value);
          closeSheet();
        } catch (e) {
          err.hidden = false;
          err.textContent = e.message;
        }
      },
    }, 'Add playlist')
  );
  setTimeout(() => area.focus(), 300);
}

async function importTransferText(text) {
  const data = await decodeTransfer(text);
  let pl = S.playlists.find((p) => p.source === 'spotify' && p.sid === data.sid);
  const oldItems = pl ? pl.items : [];
  let added = 0;
  let items;
  if (data.add) {
    // Songs added one by one from Spotify's ⋯ menu: keep what's there, append only new songs.
    const fresh = data.items.filter((it) => !oldItems.some((o) => sameSong(o, it)));
    added = fresh.length;
    items = [...oldItems, ...fresh.map((it) => ({ ...it, trackId: null }))];
  } else {
    items = data.items.map((it) => {
      const prev = oldItems.find((o) => o.trackId && sameSong(o, it));
      return { ...it, trackId: prev ? prev.trackId : null };
    });
  }
  if (pl) Object.assign(pl, { name: data.name, cover: data.cover, items, updatedAt: Date.now() });
  else {
    pl = { id: uid(), source: 'spotify', sid: data.sid, name: data.name, cover: data.cover, items, updatedAt: Date.now() };
    S.playlists.push(pl);
  }
  await db.put('playlists', pl);
  await relinkAll();
  sortPlaylists();
  go({ name: 'playlist', id: pl.id }, true);
  const have = owned(pl).length;
  if (data.add) toast(added ? `Added ${added} new song${added === 1 ? '' : 's'}. ${have} of ${pl.items.length} offline.` : `Nothing new. ${have} of ${pl.items.length} songs offline.`);
  else toast(`${pl.name}: ${have} of ${pl.items.length} songs offline.`);
  return pl;
}

/* ------------------------------------------------------------- menus/sheets */
function sheet(...content) {
  closeSheet();
  const el = h('div', { id: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-scrim', onclick: closeSheet }), h('div', { class: 'sheet-body' }, h('div', { class: 'grabber' }), ...content));
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('open'));
  return el;
}

function closeSheet() {
  const el = $('#sheet');
  if (el) el.remove();
}

const sheetBtn = (label, fn, danger) => h('button', { type: 'button', class: 'sheet-btn' + (danger ? ' danger' : ''), onclick: () => { closeSheet(); fn(); } }, label);

function songMenu(t) {
  const locals = S.playlists.filter((p) => p.source === 'local');
  sheet(
    h('h2', null, t.title),
    h('p', { class: 'body' }, t.artist || 'Unknown artist'),
    sheetBtn('Play next', () => {
      if (S.qi < 0) return playIds([t.id], 0, false);
      S.queue.splice(S.qi + 1, 0, t.id);
      toast('Plays next.');
    }),
    ...locals.map((p) =>
      sheetBtn(`Add to ${p.name}`, async () => {
        p.items.push({ title: t.title, artist: t.artist, album: t.album, duration: t.duration, art: '', trackId: t.id });
        p.updatedAt = Date.now();
        await db.put('playlists', p);
        toast(`Added to ${p.name}.`);
        render();
      })
    ),
    sheetBtn('Add to a new playlist', async () => {
      const p = await newPlaylist(true);
      if (!p) return;
      p.items.push({ title: t.title, artist: t.artist, album: t.album, duration: t.duration, art: '', trackId: t.id });
      await db.put('playlists', p);
      render();
    }),
    sheetBtn(
      'Remove from Stash',
      async () => {
        if (!confirm(`Remove “${t.title}” from this phone? You’d need to add the file again to play it.`)) return;
        await db.del('tracks', t.id);
        S.tracks.delete(t.id);
        for (const p of S.playlists) {
          const before = p.items.length;
          if (p.source === 'local') p.items = p.items.filter((it) => it.trackId !== t.id);
          else p.items.forEach((it) => it.trackId === t.id && (it.trackId = null));
          if (p.source === 'local' ? p.items.length !== before : true) await db.put('playlists', p);
        }
        render();
        toast('Removed.');
      },
      true
    )
  );
}

function playlistMenu(pl) {
  sheet(
    h('h2', null, pl.name),
    pl.source === 'local'
      ? sheetBtn('Rename', async () => {
          const name = prompt('Playlist name', pl.name);
          if (!name || !name.trim()) return;
          pl.name = name.trim();
          await db.put('playlists', pl);
          render();
        })
      : null,
    sheetBtn(
      'Delete playlist',
      async () => {
        if (!confirm(`Delete the playlist “${pl.name}”? The songs stay in Stash.`)) return;
        await db.del('playlists', pl.id);
        S.playlists = S.playlists.filter((p) => p !== pl);
        go({ name: 'playlists' }, true);
      },
      true
    )
  );
}

async function newPlaylist(quiet) {
  const name = prompt('Name your playlist', 'My offline mix');
  if (!name || !name.trim()) return null;
  const pl = { id: uid(), source: 'local', sid: '', name: name.trim(), cover: '', items: [], updatedAt: Date.now() };
  S.playlists.push(pl);
  await db.put('playlists', pl);
  sortPlaylists();
  if (quiet === true) toast(`Made ${pl.name}.`);
  else go({ name: 'playlist', id: pl.id });
  return pl;
}

function pickSongsFor(pl) {
  const all = [...S.tracks.values()].sort((a, b) => a.title.localeCompare(b.title));
  if (!all.length) return toast('Add some songs to Stash first.');
  const inList = new Set(pl.items.map((it) => it.trackId));
  const picked = new Set();
  const rows = all.map((t) =>
    h('label', { class: 'pick' }, h('input', { type: 'checkbox', disabled: inList.has(t.id), checked: inList.has(t.id), onchange: (e) => (e.target.checked ? picked.add(t.id) : picked.delete(t.id)) }), cover(artFor(t), 'small', t.title), h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, t.title), h('span', { class: 'row-sub' }, t.artist)))
  );
  sheet(
    h('h2', null, `Add to ${pl.name}`),
    h('div', { class: 'pick-list' }, ...rows),
    h('button', {
      type: 'button',
      class: 'btn primary wide',
      onclick: async () => {
        for (const id of picked) {
          const t = S.tracks.get(id);
          pl.items.push({ title: t.title, artist: t.artist, album: t.album, duration: t.duration, art: '', trackId: id });
        }
        pl.updatedAt = Date.now();
        await db.put('playlists', pl);
        closeSheet();
        render();
      },
    }, 'Add')
  );
}

let toastTimer = 0;
function toast(msg, sticky) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ------------------------------------------------------------------ player */
// iPhone only lets a page start audio from a tap. Starting (silent) playback during the tap
// unlocks the <audio> element, so the song can load from storage a moment later.
const SILENCE = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA==';
let unlocked = false;
function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  audio.src = SILENCE;
  audio.play().catch(() => {});
}

let currentUrl = '';
function playIds(ids, index, shuffle) {
  if (!ids.length) return;
  unlockAudio();
  S.shuffle = !!shuffle;
  let order = ids.slice();
  if (shuffle) {
    order = shuffled(order);
    index = 0;
  }
  S.queue = order;
  S.qi = Math.max(0, Math.min(index, order.length - 1));
  S.baseOrder = ids.slice();
  loadAndPlay();
}

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let loadToken = 0;
async function loadAndPlay(autoplay = true) {
  const id = S.queue[S.qi];
  if (!id) return;
  const token = ++loadToken;
  const full = await db.get('tracks', id);
  if (token !== loadToken) return;
  if (!full) {
    S.queue.splice(S.qi, 1);
    return loadAndPlay(autoplay);
  }
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(new Blob([full.audio], { type: full.type || 'audio/mpeg' }));
  audio.src = currentUrl;
  if (autoplay) audio.play().catch(() => updateMini());
  setMediaSession(S.tracks.get(id));
  updateMini();
  updateNowPlaying(true);
  if (S.view.name !== 'settings') render();
  if (!S.tracks.get(id).lyrics) lyricsQueue.push(id, true);
}

function togglePlay() {
  if (S.qi < 0) return;
  if (audio.paused) {
    if (!audio.src || audio.src === SILENCE) loadAndPlay();
    else audio.play().catch(() => {});
  } else audio.pause();
}

function next(auto) {
  if (S.qi < 0) return;
  if (auto && S.repeat === 'one') {
    audio.currentTime = 0;
    return audio.play();
  }
  if (S.qi < S.queue.length - 1) S.qi++;
  else if (S.repeat === 'all' || !auto) S.qi = 0;
  else {
    audio.pause();
    audio.currentTime = 0;
    return updateMini();
  }
  loadAndPlay();
}

function prev() {
  if (S.qi < 0) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  S.qi = S.qi > 0 ? S.qi - 1 : S.repeat === 'all' ? S.queue.length - 1 : 0;
  loadAndPlay();
}

audio.addEventListener('ended', () => audio.src !== SILENCE && next(true));
for (const ev of ['play', 'pause']) audio.addEventListener(ev, () => {
  updateMini();
  updateNowPlaying();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
});
audio.addEventListener('timeupdate', () => {
  updateProgress();
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && audio.duration) {
    try {
      navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 });
    } catch (e) {
      /* ignore */
    }
  }
});

function setMediaSession(t) {
  if (!('mediaSession' in navigator) || !t) return;
  const art = artFor(t);
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: art ? [{ src: art, sizes: '512x512', type: 'image/jpeg' }] : [] });
  const set = (a, fn) => {
    try {
      navigator.mediaSession.setActionHandler(a, fn);
    } catch (e) {
      /* unsupported action */
    }
  };
  set('play', () => audio.play());
  set('pause', () => audio.pause());
  set('nexttrack', () => next(false));
  set('previoustrack', () => prev());
  set('seekto', (d) => (audio.currentTime = d.seekTime));
}

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function current() {
  return S.qi >= 0 ? S.tracks.get(S.queue[S.qi]) : null;
}

function updateMini() {
  const t = current();
  const mini = $('#mini');
  mini.hidden = !t;
  document.documentElement.classList.toggle('has-mini', !!t);
  if (!t) return;
  $('.mini-art', mini).replaceChildren(cover(artFor(t), 'small', t.title));
  $('.mini-title', mini).textContent = t.title;
  $('.mini-artist', mini).textContent = t.artist;
  const btn = $('.mini-play', mini);
  btn.innerHTML = audio.paused ? ICONS.play : ICONS.pause;
  btn.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  if (S.settings.theme === 'glass') document.documentElement.style.setProperty('--glass-art', artFor(t) ? `url("${artFor(t)}")` : 'none');
}

function updateProgress() {
  const d = audio.duration || (current() || {}).duration || 0;
  const f = d ? audio.currentTime / d : 0;
  $('#mini .mini-bar').style.transform = `scaleX(${f})`;
  if (!np.el.hidden) {
    if (!np.seeking) np.seek.value = String(Math.round(f * 1000));
    np.time.textContent = fmt(audio.currentTime);
    np.dur.textContent = fmt(d);
  }
}

/* ------------------------------------------------------------- now playing */
const np = {};
function buildNowPlaying() {
  np.el = $('#np');
  np.art = h('div', { class: 'np-art' });
  np.title = h('h2', { class: 'np-title' });
  np.artist = h('p', { class: 'np-artist' });
  np.seek = h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'seek', 'aria-label': 'Position' });
  np.seek.addEventListener('input', () => (np.seeking = true));
  np.seek.addEventListener('change', () => {
    np.seeking = false;
    if (audio.duration) audio.currentTime = (np.seek.value / 1000) * audio.duration;
  });
  np.time = h('span');
  np.dur = h('span');
  np.play = h('button', { type: 'button', class: 'np-play', 'aria-label': 'Play', onclick: togglePlay });
  np.shuffle = h('button', { type: 'button', class: 'np-side', 'aria-label': 'Shuffle', onclick: toggleShuffle }, icon('shuffle'));
  np.repeat = h('button', { type: 'button', class: 'np-side', 'aria-label': 'Repeat', onclick: cycleRepeat }, icon('repeat'), h('b', { class: 'one' }, '1'));
  np.lyrics = h('div', { class: 'lyrics' });
  np.el.append(
    h('div', { class: 'np-bg' }),
    h('div', { class: 'np-top' }, h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: closeNowPlaying }, icon('down')), h('span', { class: 'np-from' }, 'Now playing')),
    np.art,
    h('div', { class: 'np-meta' }, np.title, np.artist),
    np.seek,
    h('div', { class: 'np-times' }, np.time, np.dur),
    h('div', { class: 'np-controls' }, np.shuffle, h('button', { type: 'button', class: 'np-skip', 'aria-label': 'Previous', onclick: prev, html: ICONS.prev }), np.play, h('button', { type: 'button', class: 'np-skip', 'aria-label': 'Next', onclick: () => next(false), html: ICONS.next }), np.repeat),
    np.lyrics
  );
}

function openNowPlaying() {
  np.el.hidden = false;
  document.documentElement.classList.add('np-open');
  updateNowPlaying(true);
  updateProgress();
  startLyricFrames();
}

function closeNowPlaying() {
  np.el.hidden = true;
  document.documentElement.classList.remove('np-open');
}

function toggleShuffle() {
  S.shuffle = !S.shuffle;
  const cur = S.queue[S.qi];
  if (S.shuffle) {
    const rest = shuffled(S.queue.filter((id) => id !== cur));
    S.queue = [cur, ...rest];
    S.qi = 0;
  } else if (S.baseOrder) {
    S.queue = S.baseOrder.slice();
    S.qi = Math.max(0, S.queue.indexOf(cur));
  }
  updateNowPlaying();
}

function cycleRepeat() {
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  updateNowPlaying();
}

let lyricTrack = null;
function updateNowPlaying(trackChanged) {
  if (!np.el) return;
  const t = current();
  np.play.innerHTML = audio.paused ? ICONS.play : ICONS.pause;
  np.play.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  np.shuffle.setAttribute('aria-pressed', String(S.shuffle));
  np.repeat.setAttribute('aria-pressed', String(S.repeat !== 'off'));
  np.repeat.classList.toggle('is-one', S.repeat === 'one');
  if (!t) return;
  if (trackChanged || lyricTrack !== t.id || np.lyricsStale) {
    np.art.replaceChildren(cover(artFor(t), 'huge', t.title));
    np.title.textContent = t.title;
    np.artist.textContent = t.artist || 'Unknown artist';
    np.el.style.setProperty('--np-art', artFor(t) ? `url("${artFor(t)}")` : 'none');
    renderLyrics(t);
  }
}

function renderLyrics(t) {
  lyricTrack = t.id;
  np.lyricsStale = false;
  np.lines = [];
  const L = t.lyrics;
  if (L && L.synced && L.synced.length) {
    np.lines = L.synced.map((l) =>
      h('p', { class: 'ly', onclick: () => { audio.currentTime = l.t; audio.play().catch(() => {}); } }, l.text || '♪')
    );
    np.lyrics.replaceChildren(h('h3', null, 'Lyrics'), ...np.lines);
  } else if (L && L.plain) {
    np.lyrics.replaceChildren(h('h3', null, 'Lyrics'), ...L.plain.split('\n').map((x) => h('p', { class: 'ly plain' }, x || ' ')));
  } else if (L && L.instrumental) {
    np.lyrics.replaceChildren(h('p', { class: 'ly-note' }, 'Instrumental.'));
  } else if (L) {
    np.lyrics.replaceChildren(h('p', { class: 'ly-note' }, 'No lyrics found for this song.'));
  } else {
    np.lyrics.replaceChildren(h('p', { class: 'ly-note' }, navigator.onLine ? 'Getting lyrics…' : 'Lyrics will download next time you’re online, then work offline.'));
  }
  np.lastLine = -1;
}

let frameOn = false;
function startLyricFrames() {
  if (frameOn) return;
  frameOn = true;
  const tick = () => {
    if (np.el.hidden) {
      frameOn = false;
      return;
    }
    const t = current();
    const L = t && t.lyrics && t.lyrics.synced;
    if (L && np.lines.length) {
      const now = audio.currentTime + 0.25;
      let i = -1;
      for (let k = 0; k < L.length && L[k].t <= now; k++) i = k;
      if (i !== np.lastLine) {
        if (np.lastLine >= 0 && np.lines[np.lastLine]) np.lines[np.lastLine].classList.remove('on');
        if (i >= 0) {
          np.lines[i].classList.add('on');
          np.lines[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        np.lastLine = i;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------------------------------------------------------- lyrics queue */
// Fetches lyrics one song at a time whenever online, and stores them for offline use.
const lyricsQueue = {
  ids: [],
  busy: false,
  push(id, front) {
    this.ids = this.ids.filter((x) => x !== id);
    front ? this.ids.unshift(id) : this.ids.push(id);
    this.run();
  },
  kick(retryNotFound) {
    for (const t of S.tracks.values()) {
      // "Get lyrics now" also retries songs that had none the last time (LRCLIB grows daily).
      if (retryNotFound && t.lyrics && !t.lyrics.synced && !t.lyrics.plain && !t.lyrics.instrumental) t.lyrics = null;
      if (!t.lyrics && !this.ids.includes(t.id)) this.ids.push(t.id);
    }
    this.run();
  },
  async run() {
    if (this.busy || !navigator.onLine) return;
    this.busy = true;
    while (this.ids.length && navigator.onLine) {
      const id = this.ids.shift();
      const t = S.tracks.get(id);
      if (!t || t.lyrics) continue;
      try {
        const lyrics = await findLyrics(t);
        await setTrackField(id, { lyrics });
        if (current() && current().id === id) {
          np.lyricsStale = true;
          updateNowPlaying();
        }
      } catch (e) {
        break; // offline or LRCLIB down: try again later
      }
    }
    this.busy = false;
  },
};

boot();
