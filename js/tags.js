// Reads title / artist / album / cover from a song file. Supports MP3 (ID3v2.2-2.4),
// M4A/AAC/ALAC (iTunes atoms) and FLAC (Vorbis comments). Anything else, or a file without
// tags, falls back to the file name ("Artist - Title.mp3").

export async function readTags(file) {
  let tags = {};
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const str = (a, b) => String.fromCharCode(...head.slice(a, b));
    if (str(0, 3) === 'ID3') tags = await id3(file);
    else if (str(0, 4) === 'fLaC') tags = await flac(file);
    else if (str(4, 8) === 'ftyp') tags = await mp4(file);
  } catch (e) {
    tags = {};
  }
  const fromName = parseName(file.name);
  return {
    title: clean(tags.title) || fromName.title,
    artist: clean(tags.artist) || fromName.artist,
    album: clean(tags.album) || '',
    art: tags.art || null,
  };
}

const clean = (s) => (s || '').replace(/\u0000/g, '').trim();

export function parseName(name) {
  let base = name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').trim();
  base = base.replace(/^\d{1,3}[\s.\-)]+(?=\S)/, ''); // "01 - " track numbers
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: base };
}

/* ---------------------------------------------------------------- MP3 ID3v2 */

async function id3(file) {
  const h = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  const ver = h[3];
  const size = syncsafe(h, 6);
  const buf = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  const out = {};
  let p = 0;
  if (h[5] & 0x40 && ver >= 3) p += ver === 4 ? syncsafe(buf, 0) : u32(buf, 0) + 4; // extended header
  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  const names = ver === 2 ? { TT2: 'title', TP1: 'artist', TAL: 'album' } : { TIT2: 'title', TPE1: 'artist', TALB: 'album' };
  while (p + hdrLen < buf.length) {
    const id = String.fromCharCode(...buf.slice(p, p + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const len = ver === 2 ? (buf[p + 3] << 16) | (buf[p + 4] << 8) | buf[p + 5] : ver === 4 ? syncsafe(buf, p + 4) : u32(buf, p + 4);
    const body = buf.subarray(p + hdrLen, p + hdrLen + len);
    if (names[id]) out[names[id]] = text(body[0], body.subarray(1));
    else if ((id === 'APIC' || id === 'PIC') && !out.art) out.art = picture(body, ver);
    p += hdrLen + len;
  }
  return out;
}

function picture(b, ver) {
  const enc = b[0];
  let p = 1;
  let mime = 'image/jpeg';
  if (ver === 2) {
    const fmt = String.fromCharCode(b[1], b[2], b[3]).toLowerCase();
    mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
    p = 4;
  } else {
    const end = b.indexOf(0, p);
    mime = String.fromCharCode(...b.subarray(p, end)) || mime;
    if (!mime.includes('/')) mime = 'image/' + mime.toLowerCase();
    p = end + 1;
  }
  p += 1; // picture type
  p = skipString(b, p, enc);
  return new Blob([b.slice(p)], { type: mime });
}

function skipString(b, p, enc) {
  if (enc === 1 || enc === 2) {
    while (p + 1 < b.length && !(b[p] === 0 && b[p + 1] === 0)) p += 2;
    return p + 2;
  }
  while (p < b.length && b[p] !== 0) p++;
  return p + 1;
}

function text(enc, b) {
  try {
    if (enc === 0) return new TextDecoder('latin1').decode(b);
    if (enc === 1) return new TextDecoder(b[0] === 0xfe ? 'utf-16be' : 'utf-16le').decode(b[0] === 0xff || b[0] === 0xfe ? b.subarray(2) : b);
    if (enc === 2) return new TextDecoder('utf-16be').decode(b);
    return new TextDecoder('utf-8').decode(b);
  } catch (e) {
    return '';
  }
}

const syncsafe = (b, p) => (b[p] << 21) | (b[p + 1] << 14) | (b[p + 2] << 7) | b[p + 3];
const u32 = (b, p) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];

/* ------------------------------------------------------------------- FLAC */

async function flac(file) {
  const buf = new Uint8Array(await file.slice(0, Math.min(file.size, 4 * 1024 * 1024)).arrayBuffer());
  const out = {};
  let p = 4;
  while (p + 4 <= buf.length) {
    const last = buf[p] & 0x80;
    const type = buf[p] & 0x7f;
    const len = (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3];
    const body = buf.subarray(p + 4, p + 4 + len);
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    if (type === 4) {
      let q = 4 + dv.getUint32(0, true);
      const n = dv.getUint32(q, true);
      q += 4;
      for (let i = 0; i < n && q + 4 <= body.length; i++) {
        const l = dv.getUint32(q, true);
        const kv = new TextDecoder().decode(body.subarray(q + 4, q + 4 + l));
        q += 4 + l;
        const eq = kv.indexOf('=');
        const k = kv.slice(0, eq).toUpperCase();
        const v = kv.slice(eq + 1);
        if (k === 'TITLE') out.title = v;
        else if (k === 'ARTIST' && !out.artist) out.artist = v;
        else if (k === 'ALBUM') out.album = v;
      }
    } else if (type === 6 && !out.art) {
      let q = 4;
      const ml = dv.getUint32(q);
      const mime = new TextDecoder().decode(body.subarray(q + 4, q + 4 + ml));
      q += 4 + ml;
      q += 4 + dv.getUint32(q) + 16; // description + width/height/depth/colours
      const dl = dv.getUint32(q);
      out.art = new Blob([body.slice(q + 4, q + 4 + dl)], { type: mime || 'image/jpeg' });
    }
    if (last) break;
    p += 4 + len;
  }
  return out;
}

/* -------------------------------------------------------------------- MP4 */

async function mp4(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  const out = {};
  const keys = { '©nam': 'title', '©ART': 'artist', aART: 'artist', '©alb': 'album' };
  const walk = (start, end, path) => {
    let p = start;
    while (p + 8 <= end) {
      let size = dv.getUint32(p);
      const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
      let hdr = 8;
      if (size === 1) {
        size = Number(dv.getBigUint64(p + 8));
        hdr = 16;
      } else if (size === 0) size = end - p;
      if (size < hdr) break;
      const bodyStart = p + hdr;
      const bodyEnd = Math.min(p + size, end);
      if (type === 'moov' || type === 'udta' || type === 'ilst') walk(bodyStart, bodyEnd, path + '/' + type);
      else if (type === 'meta') walk(bodyStart + 4, bodyEnd, path + '/meta');
      else if (path.endsWith('/ilst')) {
        // item atom holds a 'data' atom: 4 size, 4 'data', 4 type, 4 locale, then the value
        const dataType = dv.getUint32(bodyStart + 8) & 0xffffff;
        const val = buf.subarray(bodyStart + 16, bodyEnd);
        if (type === 'covr' && !out.art) out.art = new Blob([val.slice()], { type: dataType === 14 ? 'image/png' : 'image/jpeg' });
        else if (keys[type] && !(keys[type] === 'artist' && out.artist && type === 'aART')) out[keys[type]] = new TextDecoder().decode(val);
      }
      p += size;
    }
  };
  walk(0, buf.length, '');
  return out;
}
