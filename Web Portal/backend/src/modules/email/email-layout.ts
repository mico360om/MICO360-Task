import { resolveBrand, type Brand } from './brand';
import { t, isRtl, type Locale } from './i18n';

export type Tone = 'info' | 'success' | 'warning' | 'danger';

/** A structured content block. Templates declare these; both HTML + plain text are derived. */
export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'code'; code: string; note?: string }
  | { kind: 'button'; label: string; href: string }
  | { kind: 'details'; rows: Array<[string, string]> }
  | { kind: 'callout'; text: string; tone?: Tone }
  | { kind: 'list'; items: string[] }
  | { kind: 'links'; items: Array<{ label: string; href: string }> }
  | { kind: 'chips'; items: EmailChip[] }
  | { kind: 'project'; project: EmailProjectCard; items: EmailTaskItem[]; more?: { text: string; href: string } }
  | { kind: 'divider' };

/** A label's colour: a tone, plain grey ('neutral'), quieter grey ('muted') or an outline. */
export type ChipTone = Tone | 'neutral' | 'muted' | 'outline';

/** A small rounded label ("2 days overdue", "High priority", "In Progress"). */
export interface EmailChip {
  text: string;
  tone: ChipTone;
}

/** One task in a `project` block: its title links to it; its key and labels beneath; an Open button. */
export interface EmailTaskItem {
  title: string;
  href: string;
  key: string;
  chips: EmailChip[];
}

/** The head of a `project` block: picture (or initials on its colour), name, details, labels, link. */
export interface EmailProjectCard {
  name: string;
  href: string;
  /** "#RRGGBB"; anything else uses the brand's colour. */
  color?: string | null;
  /** A picture email clients can load (http/https); else the initials are shown. */
  imageUrl?: string | null;
  /** Short facts, joined with " · " (code, number, client, manager, target date). */
  details: string[];
  chips: EmailChip[];
}

/** Who the email is about, shown in its header instead of the product logo (a project's minutes). */
export interface EmailIdentity {
  name: string;
  /** A picture email clients can load (http/https); else the initials are shown on `color`. */
  imageUrl?: string | null;
  /** "#RRGGBB" for the initials tile. */
  color?: string | null;
  /** A small line above the name ("Minutes of Meeting"). */
  caption?: string;
}

export interface EmailModel {
  /** Hidden inbox-preview text (shown next to the subject in most clients). */
  preheader: string;
  heading: string;
  blocks: Block[];
  brand?: Partial<Brand>;
  locale?: Locale;
  identity?: EmailIdentity;
  /** A short note at the right of the header (today's date); hidden on phones. */
  headerNote?: string;
  /** Why the email was sent, in the footer, when it isn't "you have an account" (a shared client). */
  reason?: string;
}

/** Up to two initials: "Falcon CRM" → "FC", "Falcon" → "FA". */
function initialsOf(name: string): string {
  // The words' letters and digits ("Rig & Co" → "RC", "(Alpha) Beta" → "AB").
  const words = name
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length > 1 ? [[...words[0]!][0], [...words[1]!][0]] : [...words[0]!].slice(0, 2);
  return letters.join('').toUpperCase();
}

/**
 * White or near-black initials, whichever has more contrast on the colour (WCAG), as the website's
 * project tiles do: white on amber (#B7791F) was only 3.6:1.
 */
function initialsInk(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  return (lum + 0.05) / (0.0109 + 0.05) > 1.05 / (lum + 0.05) ? '#1f1a17' : '#FFFFFF';
}

/** The header's mark and name for an identity: its picture (or initials on its colour) and name. */
function identityHeader(id: EmailIdentity, brand: Brand, dir: 'ltr' | 'rtl'): string {
  const c = brand.colors;
  const picture = id.imageUrl && /^https?:\/\//i.test(id.imageUrl.trim()) ? id.imageUrl.trim() : null;
  const tile = /^#[0-9a-f]{6}$/i.test(id.color ?? '') ? id.color! : c.brand2;
  const mark = picture
    ? `<img src="${escapeHtml(picture)}" alt="${escapeHtml(id.name)}" width="48" height="48" style="display:block;border:0;width:48px;height:48px;border-radius:12px;background:#FFFFFF;object-fit:cover;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${c.onBrand}"/>`
    : `<div style="width:48px;height:48px;border-radius:12px;background:${tile};border:1px solid rgba(255,255,255,0.4);color:${initialsInk(tile)};font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:800;line-height:48px;text-align:center">${escapeHtml(initialsOf(id.name))}</div>`;
  const gap = dir === 'rtl' ? 'padding-left:14px' : 'padding-right:14px';
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td valign="middle" style="${gap}">${mark}</td>
            <td valign="middle">
              ${id.caption ? `<div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${c.onBrand};opacity:0.8">${escapeHtml(id.caption)}</div>` : ''}
              <div dir="auto" style="font-size:20px;line-height:1.25;font-weight:800;color:${c.onBrand}">${escapeHtml(id.name)}</div>
            </td>
          </tr></table>`;
}

/** Escape text for safe insertion into HTML (prevents injection from task titles, names, etc.). */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a URL for an href attribute (only http/https/mailto allowed; otherwise neutralized). */
function safeHref(url: string): string {
  const trimmed = String(url).trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return escapeHtml(trimmed);
  return '#';
}

const TONE_COLORS: Record<Tone, { bg: string; border: string; ink: string }> = {
  info: { bg: '#E9F0F7', border: '#3A6EA5', ink: '#274b70' },
  success: { bg: '#E9F4EE', border: '#2E7D53', ink: '#1f5a3b' },
  warning: { bg: '#FBF1E1', border: '#B87611', ink: '#7c4f0b' },
  danger: { bg: '#FBEDEA', border: '#CB4632', ink: '#8f2f20' },
};

/** A colour email clients can be given safely ("#RRGGBB"), else the fallback. */
const safeColor = (value: string | null | undefined, fallback: string) => (/^#[0-9a-f]{6}$/i.test(value ?? '') ? value! : fallback);
/** An http(s) picture address, else null. */
const safePicture = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url.trim()) ? url.trim() : null);
/** An http(s) link for the plain-text version, else null. */
const textLink = (href: string) => (/^https?:\/\//i.test(href.trim()) ? href.trim() : null);

function chipHtml(chip: EmailChip): string {
  const look =
    chip.tone === 'neutral'
      ? { cls: 'email-chip-neutral', style: 'background:#F1EEEC;color:#4A403D' }
      : chip.tone === 'muted'
        ? { cls: 'email-chip-neutral', style: 'background:#F1EEEC;color:#6C625F' }
        : chip.tone === 'outline'
          ? { cls: 'email-chip-outline', style: 'background:#FFFFFF;color:#4A403D;border:1px solid #D9D0CC;padding:2px 9px' }
          : { cls: 'email-chip', style: `background:${TONE_COLORS[chip.tone].bg};color:${TONE_COLORS[chip.tone].ink}` };
  return `<span class="${look.cls}" style="display:inline-block;margin:8px 2px 0 0;padding:3px 10px;border-radius:999px;font-size:12px;line-height:18px;font-weight:700;white-space:nowrap;${look.style}">${escapeHtml(chip.text)}</span>`;
}
// A space between labels: Outlook, screen readers and copied text would otherwise run them together.
const chipsHtml = (chips: EmailChip[]) => chips.map(chipHtml).join(' ');
const chipsText = (chips: EmailChip[]) => chips.map((ch) => ch.text).join(' · ');

/** A project's picture, or its initials on its colour, as a 42 px tile. */
function projectTile(p: EmailProjectCard, color: string): string {
  const picture = safePicture(p.imageUrl);
  return picture
    ? `<img src="${escapeHtml(picture)}" alt="" width="42" height="42" style="display:block;border:0;width:42px;height:42px;border-radius:10px;object-fit:cover;font-family:Arial,Helvetica,sans-serif;font-size:11px"/>`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="42" height="42" align="center" bgcolor="${color}" style="width:42px;height:42px;border-radius:10px;background:${color};color:${initialsInk(color)};font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:800;line-height:42px;text-align:center">${escapeHtml(initialsOf(p.name))}</td></tr></table>`;
}

function renderBlockHtml(block: Block, brand: Brand, locale: Locale): string {
  const c = brand.colors;
  switch (block.kind) {
    case 'text':
      return `<p class="email-text" style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${c.ink}">${escapeHtml(block.text)}</p>`;
    case 'code':
      return `<div style="margin:0 0 16px">
        <div class="email-code" style="background:${c.ground};border:1px solid ${c.line};border-radius:12px;padding:18px;text-align:center">
          <span style="font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:700;letter-spacing:8px;color:${c.brand}">${escapeHtml(block.code)}</span>
        </div>${block.note ? `<p class="email-muted" style="margin:8px 0 0;font-size:12px;color:${c.ink2};text-align:center">${escapeHtml(block.note)}</p>` : ''}
      </div>`;
    case 'button':
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px" class="email-button"><tr><td align="center" bgcolor="${c.brand}" style="border-radius:12px;background:${c.brand};background:linear-gradient(135deg,${c.brand2} 0%,${c.brand} 100%)">
        <a href="${safeHref(block.href)}" target="_blank" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:${c.onBrand};text-decoration:none;border-radius:12px">${escapeHtml(block.label)}</a>
      </td></tr></table>`;
    case 'details':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-details" style="margin:0 0 16px;border:1px solid ${c.line};border-radius:12px;overflow:hidden">
        ${block.rows
          .map(
            ([label, value], i) =>
              `<tr style="background:${i % 2 ? c.ground : c.surface}"><td class="email-muted" style="padding:10px 14px;font-size:13px;color:${c.ink2};width:40%">${escapeHtml(label)}</td><td dir="auto" class="email-text" style="padding:10px 14px;font-size:14px;font-weight:600;color:${c.ink}">${escapeHtml(value)}</td></tr>`,
          )
          .join('')}
      </table>`;
    case 'callout': {
      const tone = TONE_COLORS[block.tone ?? 'info'];
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr><td dir="auto" style="background:${tone.bg};border-left:4px solid ${tone.border};border-radius:8px;padding:12px 16px;font-size:14px;line-height:1.5;color:${tone.ink}">${escapeHtml(block.text)}</td></tr></table>`;
    }
    case 'list':
      return `<ul class="email-text" style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.7;color:${c.ink}">${block.items
        .map((item) => `<li dir="auto" style="margin:0 0 4px">${escapeHtml(item)}</li>`)
        .join('')}</ul>`;
    case 'links':
      return `<ul class="email-text" style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.7;color:${c.ink}">${block.items
        .map((item) => `<li style="margin:0 0 4px"><a href="${safeHref(item.href)}" target="_blank" class="email-link" style="font-weight:700;color:${c.brand};text-decoration:underline">${escapeHtml(item.label)}</a></li>`)
        .join('')}</ul>`;
    case 'chips':
      return `<div style="margin:0 0 22px">${chipsHtml(block.items)}</div>`;
    case 'project': {
      const p = block.project;
      const color = safeColor(p.color, c.brand2);
      const align = isRtl(locale) ? 'right' : 'left';
      const button = (href: string, key: string) =>
        `<a href="${safeHref(href)}" target="_blank" class="email-link" aria-label="${escapeHtml(`${t(locale, 'open')} ${key}`)}" style="display:inline-block;padding:7px 14px;border:1px solid ${c.brand};border-radius:999px;font-size:13px;font-weight:700;color:${c.brand};text-decoration:none;white-space:nowrap">${escapeHtml(t(locale, 'open'))} ›</a>`;
      const rows = block.items
        .map(
          (item, i) => `<tr><td class="email-card" style="padding:14px 16px;background:${c.surface}${i ? `;border-top:1px solid ${c.line}` : ''}">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td class="email-main" style="vertical-align:top">
                <a href="${safeHref(item.href)}" target="_blank" dir="auto" class="email-text" style="font-size:16px;font-weight:700;line-height:1.4;color:${c.ink};text-decoration:none">${escapeHtml(item.title)}</a>
                <div class="email-muted" style="margin-top:2px;font-size:13px;color:${c.ink2}">${escapeHtml(item.key)}</div>
                ${item.chips.length ? `<div>${chipsHtml(item.chips)}</div>` : ''}
              </td>
              <td class="email-stack" width="90" align="right" style="vertical-align:middle;width:90px">${button(item.href, item.key)}</td>
            </tr></table>
          </td></tr>`,
        )
        .join('');
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-details" style="margin:0 0 20px;border:1px solid ${c.line};border-radius:14px;overflow:hidden">
        <tr><td class="email-proj" style="padding:14px 16px;background:#FAF7F6;border-top:4px solid ${color};border-bottom:1px solid ${c.line}">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="54" style="vertical-align:top;width:54px">${projectTile(p, color)}</td>
            <td class="email-main" style="vertical-align:top">
              <div dir="auto" class="email-text" style="text-align:${align};font-size:17px;font-weight:800;line-height:1.3;color:${c.ink}">${escapeHtml(p.name)}</div>
              ${p.details.length ? `<div class="email-muted" style="margin-top:3px;font-size:13px;line-height:1.5;color:${c.ink2}">${escapeHtml(p.details.join(' · '))}</div>` : ''}
              ${p.chips.length ? `<div>${chipsHtml(p.chips)}</div>` : ''}
            </td>
            <td class="email-stack" width="120" align="right" style="vertical-align:top;width:120px"><a href="${safeHref(p.href)}" target="_blank" class="email-link" aria-label="${escapeHtml(`${t(locale, 'openProject')} ${p.name}`)}" style="font-size:13px;font-weight:700;color:${c.brand};text-decoration:none;white-space:nowrap">${escapeHtml(t(locale, 'openProject'))} ›</a></td>
          </tr></table>
        </td></tr>
        ${rows}
        ${block.more ? `<tr><td class="email-card" style="padding:12px 16px;background:${c.surface};border-top:1px solid ${c.line}"><a href="${safeHref(block.more.href)}" target="_blank" class="email-link" style="font-size:13px;font-weight:700;color:${c.brand};text-decoration:none">${escapeHtml(block.more.text)} ›</a></td></tr>` : ''}
      </table>`;
    }
    case 'divider':
      return `<hr class="email-divider" style="border:none;border-top:1px solid ${c.line};margin:8px 0 20px"/>`;
  }
}

function renderBlockText(block: Block): string {
  switch (block.kind) {
    case 'text':
      return block.text;
    case 'code':
      return `    ${block.code}${block.note ? `\n(${block.note})` : ''}`;
    case 'button':
      return `${block.label}: ${block.href}`;
    case 'details':
      return block.rows.map(([label, value]) => `  - ${label}: ${value}`).join('\n');
    case 'callout':
      return `> ${block.text}`;
    case 'list':
      return block.items.map((i) => `  - ${i}`).join('\n');
    case 'links':
      return block.items.map((i) => `  - ${i.label}: ${i.href}`).join('\n');
    case 'chips':
      return chipsText(block.items);
    case 'project': {
      const p = block.project;
      const head = [`${p.name.toUpperCase()}${p.details.length ? ` — ${p.details.join(' · ')}` : ''}`, p.chips.length ? chipsText(p.chips) : null, textLink(p.href)];
      const items = block.items.map((i) => {
        const line = `- ${i.title} (${i.key})${i.chips.length ? ` — ${chipsText(i.chips)}` : ''}`;
        const link = textLink(i.href);
        return link ? `${line}\n  ${link}` : line;
      });
      const more = block.more ? [`${block.more.text}${textLink(block.more.href) ? `: ${textLink(block.more.href)}` : ''}`] : [];
      return [...head.filter(Boolean), ...items, ...more].join('\n');
    }
    case 'divider':
      return '----------------------------------------';
  }
}

/** Render the responsive, light/dark HTML email + a plain-text alternative from a content model. */
export function renderEmail(model: EmailModel): { html: string; text: string } {
  const brand = resolveBrand(model.brand);
  const locale: Locale = model.locale ?? 'en';
  const c = brand.colors;
  const dir = isRtl(locale) ? 'rtl' : 'ltr';

  const logo = brand.logoUrl
    ? `<img src="${safeHref(brand.logoUrl)}" alt="${escapeHtml(brand.productName)}" width="64" height="30" style="display:block;border:0;width:64px;height:30px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:800;color:${c.onBrand}"/>`
    : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.3px;color:${c.onBrand}">${escapeHtml(brand.wordmark.pre)}<span style="opacity:0.85">${escapeHtml(brand.wordmark.mid)}</span> <span style="font-weight:600;opacity:0.9">${escapeHtml(brand.wordmark.post)}</span></span>`;

  const blocksHtml = model.blocks.map((b) => renderBlockHtml(b, brand, locale)).join('\n');
  const year = new Date().getFullYear();
  const reasonText = model.reason ?? t(locale, 'reasonAccount', { product: brand.productName });
  const reasonHtml = model.reason !== undefined ? escapeHtml(model.reason) : reasonText;

  const html = `<!DOCTYPE html>
<html lang="${locale}" dir="${dir}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<meta name="color-scheme" content="light dark"/>
<meta name="supported-color-schemes" content="light dark"/>
<title>${escapeHtml(brand.productName)}</title>
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  img{border:0;line-height:100%;outline:none;text-decoration:none}
  a{color:${c.brand}}
  @media (max-width:620px){
    .email-container{width:100%!important}
    .email-pad{padding-left:18px!important;padding-right:18px!important}
    .email-button a{display:block!important;text-align:center!important}
    .email-heading{font-size:22px!important}
    .email-main{display:block!important;width:auto!important}
    .email-stack{display:block!important;width:auto!important;padding:10px 0 0!important;text-align:${dir === 'rtl' ? 'right' : 'left'}!important}
    .email-head-note{display:none!important}
  }
  @media (prefers-color-scheme:dark){
    body,.email-body{background:#141110!important}
    .email-container,.email-card{background:#1E1A19!important}
    .email-heading{color:#F4F2F0!important}
    .email-text,.email-details td.email-text{color:#E7E1DE!important}
    .email-muted{color:#B8ADA9!important}
    .email-code{background:#26211F!important;border-color:#3A312E!important}
    .email-details{border-color:#3A312E!important}
    .email-details tr{background:#1E1A19!important}
    .email-divider{border-color:#3A312E!important}
    .email-footer{background:#141110!important}
    .email-footer-ink,.email-footer-ink a{color:#9B908B!important}
    .email-proj{background:#26211F!important;border-bottom-color:#3A312E!important}
    .email-proj tr{background:transparent!important}
    .email-card{border-top-color:#3A312E!important}
    .email-link{color:#F0A79B!important;border-color:#F0A79B!important}
    .email-chip-neutral{background:#332C2A!important;color:#E7E1DE!important}
    .email-chip-outline{background:transparent!important;color:#E7E1DE!important;border-color:#5A4E4A!important}
  }
</style>
</head>
<body class="email-body" style="margin:0;padding:0;background:${c.ground};font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(model.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-body" style="background:${c.ground}">
  <tr><td align="center" style="padding:24px 12px">
    <!--[if mso]><table role="presentation" width="720" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-container" style="width:100%;max-width:720px;background:${c.surface};border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -12px rgba(33,27,26,0.25)">
      <!-- Header: one slim line (logo or the email's own identity; an optional note such as the date) -->
      <tr><td style="background:${c.brand};background:linear-gradient(135deg,${c.brand2} 0%,${c.brand} 55%,#5E1414 100%);padding:${model.identity ? '16px' : '12px'} 32px" class="email-pad">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td align="${dir === 'rtl' ? 'right' : 'left'}" style="vertical-align:middle">${model.identity ? identityHeader(model.identity, brand, dir) : logo}</td>
          ${model.headerNote ? `<td class="email-head-note" align="${dir === 'rtl' ? 'left' : 'right'}" style="vertical-align:middle;font-size:13px;color:${c.onBrand};opacity:0.9;white-space:nowrap">${escapeHtml(model.headerNote)}</td>` : ''}
        </tr></table>
      </td></tr>
      <!-- Body -->
      <tr><td class="email-card email-pad" style="background:${c.surface};padding:28px 32px">
        <h1 class="email-heading" style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:${c.ink}">${escapeHtml(model.heading)}</h1>
        ${blocksHtml}
      </td></tr>
      <!-- Footer -->
      <tr><td class="email-footer email-pad" style="background:${c.footerBg};padding:18px 32px;border-top:1px solid ${c.line}">
        <p class="email-footer-ink" style="margin:0 0 6px;font-size:13px;color:${c.footerInk}">
          <a href="${safeHref(brand.appUrl)}" style="color:${c.brand};text-decoration:none;font-weight:600">${escapeHtml(brand.productName)}</a>
          &nbsp;·&nbsp; <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:${c.footerInk};text-decoration:underline">${t(locale, 'contactSupport')}</a>
          &nbsp;·&nbsp; <a href="${safeHref(brand.websiteUrl)}" style="color:${c.footerInk};text-decoration:underline">${t(locale, 'visitWebsite')}</a>
        </p>
        <p class="email-footer-ink" style="margin:0 0 6px;font-size:12px;line-height:1.5;color:${c.footerInk}">${brand.companyAddress.trim() ? `${escapeHtml(brand.companyAddress.trim().replace(/\.\s*$/, ''))}. ` : ''}${reasonHtml} ${t(locale, 'automatedNotice')}</p>
        <p class="email-footer-ink" style="margin:0;font-size:11px;line-height:1.5;color:${c.footerInk}">${t(locale, 'disclaimer')} © ${year} ${escapeHtml(brand.companyName)}. ${t(locale, 'rightsReserved')}</p>
      </td></tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr>
</table>
</body>
</html>`;

  // The template's line breaks and indentation between tags add bytes, not looks (Gmail cuts off
  // emails over about 100 KB); a single space between tags (between labels) is kept.
  const compact = html.replace(/>\s*\n\s*</g, '><');

  const text = [
    brand.productName.toUpperCase(),
    '',
    model.heading,
    '',
    model.blocks.map(renderBlockText).join('\n\n'),
    '',
    '----------------------------------------',
    `${brand.productName} — ${brand.appUrl}`,
    `${t(locale, 'contactSupport')}: ${brand.supportEmail}`,
    brand.companyAddress,
    reasonText,
    t(locale, 'automatedNotice'),
    `© ${year} ${brand.companyName}. ${t(locale, 'rightsReserved')}`,
  ].join('\n');

  return { html: compact, text };
}
