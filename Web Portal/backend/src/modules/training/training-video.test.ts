import { describe, expect, it } from 'vitest';
import { normaliseVideoLink, videoInfo } from './training-video';

const YT = 'dQw4w9WgXcQ';

describe('YouTube links', () => {
  it.each([
    `https://www.youtube.com/watch?v=${YT}`,
    `https://youtube.com/watch?v=${YT}&t=42s`,
    `http://m.youtube.com/watch?feature=share&v=${YT}`,
    `https://youtu.be/${YT}`,
    `https://youtu.be/${YT}?si=abc&t=10`,
    `https://www.youtube.com/embed/${YT}`,
    `https://www.youtube.com/embed/${YT}?start=5`,
    `https://www.youtube.com/shorts/${YT}`,
    `https://www.youtube.com/live/${YT}?feature=share`,
    `https://www.youtube-nocookie.com/embed/${YT}`,
    `  www.youtube.com/watch?v=${YT}  `,
    `youtu.be/${YT}`,
  ])('%s → the privacy embed', (link) => {
    const v = normaliseVideoLink(link);
    expect(v).toEqual({
      provider: 'YOUTUBE',
      videoId: YT,
      hash: null,
      embedUrl: `https://www.youtube-nocookie.com/embed/${YT}`,
      watchUrl: `https://www.youtube.com/watch?v=${YT}`,
    });
  });

  it.each([
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?list=PL123',
    'https://www.youtube.com/channel/UC123',
    `https://youtube.com.evil.example/watch?v=${YT}`,
    `https://evil.example/?u=https://youtu.be/${YT}`,
    `javascript:alert(1)//youtu.be/${YT}`,
    `https://www.youtube.com/watch?v=${YT}"><script>`,
  ])('refuses %s', (link) => {
    expect(() => normaliseVideoLink(link)).toThrow(/YouTube or Vimeo/);
  });
});

describe('Vimeo links', () => {
  it.each([
    ['https://vimeo.com/76979871', '76979871', null],
    ['https://www.vimeo.com/76979871?share=copy', '76979871', null],
    ['https://vimeo.com/76979871/8272103f6e', '76979871', '8272103f6e'],
    ['https://player.vimeo.com/video/76979871', '76979871', null],
    ['https://player.vimeo.com/video/76979871?h=8272103f6e&badge=0', '76979871', '8272103f6e'],
    ['https://vimeo.com/channels/staffpicks/76979871', '76979871', null],
    ['vimeo.com/76979871', '76979871', null],
  ])('%s', (link, id, hash) => {
    expect(normaliseVideoLink(link)).toEqual({
      provider: 'VIMEO',
      videoId: id,
      hash,
      embedUrl: hash ? `https://player.vimeo.com/video/${id}?h=${hash}` : `https://player.vimeo.com/video/${id}`,
      watchUrl: hash ? `https://vimeo.com/${id}/${hash}` : `https://vimeo.com/${id}`,
    });
  });

  it.each(['https://vimeo.com/channels/staffpicks', 'https://vimeo.com/user123', 'https://vimeo.com/76979871/not!a!hash', 'https://player.vimeo.com/video/abc', 'https://vimeo.com.evil.example/76979871'])('refuses %s', (link) => {
    expect(() => normaliseVideoLink(link)).toThrow(/YouTube or Vimeo/);
  });
});

describe('anything else', () => {
  it.each(['', '   ', 'not a link', 'https://example.com/video.mp4', 'ftp://youtu.be/dQw4w9WgXcQ', `https://youtu.be/${YT}`.padEnd(501, 'x')])('refuses %j with a plain message', (link) => {
    expect(() => normaliseVideoLink(link)).toThrow(/Paste a YouTube or Vimeo link/);
  });

  it('videoInfo reads a stored lesson back (null without a link)', () => {
    expect(videoInfo({ videoProvider: null, videoId: null, videoHash: null })).toBeNull();
    expect(videoInfo({ videoProvider: 'YOUTUBE', videoId: YT, videoHash: null })).toEqual({
      provider: 'YOUTUBE',
      videoId: YT,
      embedUrl: `https://www.youtube-nocookie.com/embed/${YT}`,
      watchUrl: `https://www.youtube.com/watch?v=${YT}`,
    });
    expect(videoInfo({ videoProvider: 'VIMEO', videoId: '1', videoHash: 'ab12' })?.embedUrl).toBe('https://player.vimeo.com/video/1?h=ab12');
  });
});
