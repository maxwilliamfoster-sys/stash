// Matching song files to playlist entries, the "Send to Stash" text format, and LRCLIB lyrics.

// "COMË N GO (feat. X) - Remastered 2011" -> "come n go"
export function normTitle(s) {
  return fold(s)
    .replace(/\s[-–—]\s.*$/, '') // " - Remastered", " - Live"
    .replace(/[([][^)\]]*[)\]]/g, ' ') // (feat. ...), [Explicit]
    .replace(/\b(feat|ft|featuring|with)\b.*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function artistList(s) {
  return fold(s)
    .split(/\s*(?:,|&|\bx\b|\band\b|\bfeat\.?|\bft\.?|\bwith\b|;|\/)\s*/)
    .map((a) => a.replace(/[^a-z0-9]+/g, ' ').trim())
    .filter(Boolean);
}

function fold(s) {
  return (s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'/g, '');
}

export const songKey = (title, artist) => normTitle(title) + '|' + (artistList(artist)[0] || '');

// Same song if the titles match and they share an artist (or one side has no artist).
export function sameSong(a, b) {
  const ta = normTitle(a.title);
  if (!ta || ta !== normTitle(b.title)) return false;
  const aa = artistList(a.artist);
  const ba = artistList(b.artist);
  if (!aa.length || !ba.length) return true;
  return aa.some((x) => ba.some((y) => x === y || x.includes(y) || y.includes(x)));
}

/* ------------------------------------------------------- Send to Stash text */

// STASH1: a whole playlist, deflate-compressed. STASH0: songs added one at a time from the ⋯
// menu, not compressed (so BetterSpotify can copy it instantly inside the tap).
export const TRANSFER_RE = /STASH([01]):/;
const ART = 'https://i.scdn.co/image/';

export async function decodeTransfer(text) {
  const m = (text || '').match(TRANSFER_RE);
  if (!m) throw new Error('That isn’t from BetterSpotify. In Spotify, tap Add to Stash on a playlist or in a song’s ⋯ menu first.');
  const b64 = text.slice(m.index + m[0].length).trim().split(/\s/)[0].replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64 + '==='.slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
  const body = m[1] === '1' ? new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')) : new Blob([bytes]);
  const data = JSON.parse(await new Response(body).text());
  if (data.v !== 1 || !Array.isArray(data.items)) throw new Error('This playlist was copied by a newer BetterSpotify. Update Stash and try again.');
  const art = (id) => (id ? ART + id.replace(/^ab67616d0000(4851|1e02|b273)/, 'ab67616d00001e02') : '');
  return {
    sid: String(data.sid || ''),
    name: String(data.name || 'Spotify playlist'),
    add: !!data.add,
    cover: data.cover ? (data.cover.startsWith('http') ? data.cover : art(data.cover)) : '',
    items: data.items.map(([title, artist, album, seconds, artId]) => ({
      title: String(title || ''),
      artist: String(artist || ''),
      album: String(album || ''),
      duration: Number(seconds) || 0,
      art: art(artId),
    })),
  };
}

/* ------------------------------------------------------------------ Lyrics */

const LRCLIB = 'https://lrclib.net/api';

export async function findLyrics({ title, artist, album, duration }) {
  const first = artistList(artist)[0] ? artist.split(/,|&| feat/i)[0].trim() : artist;
  const q = (o) => new URLSearchParams(o).toString();
  const get = async (url) => {
    const r = await fetch(url);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('lyrics ' + r.status);
    return r.json();
  };
  const cleanTitle = title.replace(/\s*[([].*?[)\]]/g, '').trim() || title;
  let hit = null;
  if (duration) hit = await get(`${LRCLIB}/get?${q({ track_name: cleanTitle, artist_name: first, album_name: album || '', duration: Math.round(duration) })}`).catch(() => null);
  if (!hit || (!hit.syncedLyrics && !hit.plainLyrics)) {
    const list = (await get(`${LRCLIB}/search?${q({ track_name: cleanTitle, artist_name: first })}`)) || [];
    const ok = list.filter((x) => sameSong({ title: x.trackName, artist: x.artistName }, { title, artist }));
    const near = (x) => (duration ? Math.abs((x.duration || 0) - duration) : 0);
    ok.sort((a, b) => !!b.syncedLyrics - !!a.syncedLyrics || near(a) - near(b));
    hit = ok[0] || null;
  }
  return {
    synced: hit && hit.syncedLyrics ? parseLrc(hit.syncedLyrics) : null,
    plain: hit && hit.plainLyrics ? hit.plainLyrics : null,
    instrumental: !!(hit && hit.instrumental),
    checkedAt: Date.now(),
  };
}

export function parseLrc(lrc) {
  const lines = [];
  for (const raw of lrc.split('\n')) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) lines.push({ t: +m[1] * 60 + +m[2], text: words });
  }
  return lines.sort((a, b) => a.t - b.t);
}
