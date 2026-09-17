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
  | { kind: 'divider' };

export interface EmailModel {
  /** Hidden inbox-preview text (shown next to the subject in most clients). */
  preheader: string;
  heading: string;
  blocks: Block[];
  brand?: Partial<Brand>;
  locale?: Locale;
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

function renderBlockHtml(block: Block, brand: Brand): string {
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
              `<tr style="background:${i % 2 ? c.ground : c.surface}"><td class="email-muted" style="padding:10px 14px;font-size:13px;color:${c.ink2};width:40%">${escapeHtml(label)}</td><td class="email-text" style="padding:10px 14px;font-size:14px;font-weight:600;color:${c.ink}">${escapeHtml(value)}</td></tr>`,
          )
          .join('')}
      </table>`;
    case 'callout': {
      const tone = TONE_COLORS[block.tone ?? 'info'];
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr><td style="background:${tone.bg};border-left:4px solid ${tone.border};border-radius:8px;padding:12px 16px;font-size:14px;line-height:1.5;color:${tone.ink}">${escapeHtml(block.text)}</td></tr></table>`;
    }
    case 'list':
      return `<ul class="email-text" style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.7;color:${c.ink}">${block.items
        .map((item) => `<li style="margin:0 0 4px">${escapeHtml(item)}</li>`)
        .join('')}</ul>`;
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
    ? `<img src="${safeHref(brand.logoUrl)}" alt="${escapeHtml(brand.productName)}" width="46" height="46" style="display:block;border:0;width:46px;height:46px;border-radius:12px;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:800;color:${c.onBrand}"/>`
    : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:800;letter-spacing:-0.3px;color:${c.onBrand}">${escapeHtml(brand.wordmark.pre)}<span style="opacity:0.85">${escapeHtml(brand.wordmark.mid)}</span> <span style="font-weight:600;opacity:0.9">${escapeHtml(brand.wordmark.post)}</span></span>`;

  const blocksHtml = model.blocks.map((b) => renderBlockHtml(b, brand)).join('\n');
  const year = new Date().getFullYear();

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
  @media (max-width:600px){
    .email-container{width:100%!important}
    .email-pad{padding-left:22px!important;padding-right:22px!important}
    .email-button a{display:block!important;text-align:center!important}
    .email-heading{font-size:22px!important}
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
  }
</style>
</head>
<body class="email-body" style="margin:0;padding:0;background:${c.ground};font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(model.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-body" style="background:${c.ground}">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="email-container" style="width:600px;max-width:600px;background:${c.surface};border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -12px rgba(33,27,26,0.25)">
      <!-- Header -->
      <tr><td style="background:${c.brand};background:linear-gradient(135deg,${c.brand2} 0%,${c.brand} 55%,#5E1414 100%);padding:22px 32px" class="email-pad">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td align="${dir === 'rtl' ? 'right' : 'left'}">${logo}</td>
        </tr></table>
        <div style="margin-top:4px;font-size:12px;color:${c.onBrand};opacity:0.8">${escapeHtml(brand.tagline)}</div>
      </td></tr>
      <!-- Body -->
      <tr><td class="email-card email-pad" style="background:${c.surface};padding:32px">
        <h1 class="email-heading" style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:800;color:${c.ink}">${escapeHtml(model.heading)}</h1>
        ${blocksHtml}
      </td></tr>
      <!-- Footer -->
      <tr><td class="email-footer email-pad" style="background:${c.footerBg};padding:24px 32px;border-top:1px solid ${c.line}">
        <p class="email-footer-ink" style="margin:0 0 6px;font-size:13px;color:${c.footerInk}">
          <a href="${safeHref(brand.appUrl)}" style="color:${c.brand};text-decoration:none;font-weight:600">${escapeHtml(brand.productName)}</a>
          &nbsp;·&nbsp; <a href="mailto:${escapeHtml(brand.supportEmail)}" style="color:${c.footerInk};text-decoration:underline">${t(locale, 'contactSupport')}</a>
          &nbsp;·&nbsp; <a href="${safeHref(brand.websiteUrl)}" style="color:${c.footerInk};text-decoration:underline">${t(locale, 'visitWebsite')}</a>
        </p>
        <p class="email-footer-ink" style="margin:0 0 6px;font-size:12px;color:${c.footerInk}">${escapeHtml(brand.companyAddress)}</p>
        <p class="email-footer-ink" style="margin:0 0 6px;font-size:12px;color:${c.footerInk}">${t(locale, 'reasonAccount', { product: brand.productName })} ${t(locale, 'automatedNotice')}</p>
        <p class="email-footer-ink" style="margin:0 0 6px;font-size:11px;color:${c.footerInk};line-height:1.5">${t(locale, 'disclaimer')}</p>
        <p class="email-footer-ink" style="margin:0;font-size:11px;color:${c.footerInk}">© ${year} ${escapeHtml(brand.companyName)}. ${t(locale, 'rightsReserved')}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

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
    t(locale, 'reasonAccount', { product: brand.productName }),
    t(locale, 'automatedNotice'),
    `© ${year} ${brand.companyName}. ${t(locale, 'rightsReserved')}`,
  ].join('\n');

  return { html, text };
}
