import { ValidationError } from '../../lib/http-errors';
import { LIMITS, type VideoInfo } from './training-types';

/**
 * Lesson videos (owner answer 2): YouTube or Vimeo links only (unlisted is fine), played in the lesson
 * through the privacy embeds — `www.youtube-nocookie.com/embed/<id>` and `player.vimeo.com/video/<id>`
 * (`?h=<hash>` for an unlisted Vimeo video). The CSP's frame-src allows exactly those two hosts.
 */
export interface NormalisedVideo {
  provider: 'YOUTUBE' | 'VIMEO';
  videoId: string;
  /** An unlisted Vimeo video's hash; null otherwise. */
  hash: string | null;
  embedUrl: string;
  watchUrl: string;
}

const REFUSED = 'Paste a YouTube or Vimeo link to the video (for example https://youtu.be/… or https://vimeo.com/…).';
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const VIMEO_HASH = /^[A-Za-z0-9]{1,32}$/;

const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com']);

function youtube(id: string): NormalisedVideo {
  return { provider: 'YOUTUBE', videoId: id, hash: null, embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, watchUrl: `https://www.youtube.com/watch?v=${id}` };
}

function vimeo(id: string, hash: string | null): NormalisedVideo {
  return {
    provider: 'VIMEO',
    videoId: id,
    hash,
    embedUrl: hash ? `https://player.vimeo.com/video/${id}?h=${hash}` : `https://player.vimeo.com/video/${id}`,
    watchUrl: hash ? `https://vimeo.com/${id}/${hash}` : `https://vimeo.com/${id}`,
  };
}

/** A pasted link → the video it names, or a plain refusal (400). */
export function normaliseVideoLink(raw: string): NormalisedVideo {
  const text = String(raw ?? '').trim();
  if (!text || text.length > LIMITS.videoUrl) throw new ValidationError(REFUSED, { field: 'videoUrl' });
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ValidationError(REFUSED, { field: 'videoUrl' });
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || (url.port && url.port !== '443' && url.port !== '80')) {
    throw new ValidationError(REFUSED, { field: 'videoUrl' });
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') {
    if (parts.length === 1 && YT_ID.test(parts[0]!)) return youtube(parts[0]!);
  } else if (YT_HOSTS.has(host)) {
    if (parts.length === 1 && parts[0] === 'watch') {
      const v = url.searchParams.get('v') ?? '';
      if (YT_ID.test(v)) return youtube(v);
    } else if (parts.length === 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0]!) && YT_ID.test(parts[1]!)) {
      return youtube(parts[1]!);
    }
  } else if (host === 'player.vimeo.com') {
    if (parts.length === 2 && parts[0] === 'video' && VIMEO_ID.test(parts[1]!)) {
      const h = url.searchParams.get('h');
      if (h === null) return vimeo(parts[1]!, null);
      if (VIMEO_HASH.test(h)) return vimeo(parts[1]!, h);
    }
  } else if (VIMEO_HOSTS.has(host)) {
    if (parts.length === 1 && VIMEO_ID.test(parts[0]!)) return vimeo(parts[0]!, null);
    if (parts.length === 2 && VIMEO_ID.test(parts[0]!) && VIMEO_HASH.test(parts[1]!)) return vimeo(parts[0]!, parts[1]!);
    if (parts.length === 3 && parts[0] === 'channels' && VIMEO_ID.test(parts[2]!)) return vimeo(parts[2]!, null);
  }
  throw new ValidationError(REFUSED, { field: 'videoUrl' });
}

/** A stored lesson's video for the API (null when it has no link yet). */
export function videoInfo(l: { videoProvider: string | null; videoId: string | null; videoHash: string | null }): VideoInfo | null {
  if (!l.videoId || (l.videoProvider !== 'YOUTUBE' && l.videoProvider !== 'VIMEO')) return null;
  const v = l.videoProvider === 'YOUTUBE' ? youtube(l.videoId) : vimeo(l.videoId, l.videoHash);
  return { provider: v.provider, videoId: v.videoId, embedUrl: v.embedUrl, watchUrl: v.watchUrl };
}
