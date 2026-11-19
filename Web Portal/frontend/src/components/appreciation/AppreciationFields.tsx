import { useEffect, useId, useState, type ReactNode } from 'react';
import { FieldLabel, fieldClass } from '../ui/Field';
import { ModalPortal } from '../ui/ModalPortal';
import { useDialog } from '../../hooks/useDialog';
import { dialogLayer, dialogPanel } from '../ui/dialog-size';
import { TOUCH_SQUARE } from '../../lib/touch';
import {
  ANIMATION_LABEL,
  APPRECIATION_ANIMATIONS,
  APPRECIATION_ICONS,
  APPRECIATION_THEMES,
  ICON_LABEL,
  THEME_LOOK,
  dayWords,
  fillPlaceholders,
  isCustomColour,
  normaliseColourInput,
  themeGradient,
  themeStyle,
  type AppreciationAnimation,
  type CustomColour,
} from '../../lib/appreciation';
import type { AppreciationContent } from '../../api/appreciations';
import { AppreciationIconSvg, CompanyMark } from './AppreciationArt';

/** Employee Appreciation (1.24.0): the words, theme, icon and animation — shared by Send, Edit and the template editor. */
export const LIMITS = { name: 80, title: 120, message: 1000 } as const;
export const PLACEHOLDER_HINT = 'Use {name}, {company} and {date} — each person sees their own.';

export function ContentFields({ value, onChange, errors = {} }: { value: AppreciationContent; onChange: (v: AppreciationContent) => void; errors?: Partial<Record<keyof AppreciationContent, string>> }) {
  const id = useId();
  const set = <K extends keyof AppreciationContent>(k: K, v: AppreciationContent[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={`${id}-title`} required>Title</FieldLabel>
        <input id={`${id}-title`} className={fieldClass(!!errors.title)} maxLength={LIMITS.title} value={value.title} onChange={(e) => set('title', e.target.value)} />
        {errors.title ? <p className="text-xs text-danger" role="alert">{errors.title}</p> : null}
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={`${id}-message`} required>Message</FieldLabel>
        <textarea
          id={`${id}-message`}
          rows={4}
          aria-describedby={`${id}-hint`}
          className={fieldClass(!!errors.message, 'resize-y')}
          maxLength={LIMITS.message}
          value={value.message}
          onChange={(e) => set('message', e.target.value)}
        />
        <p id={`${id}-hint`} className="text-xs text-ink-2">{PLACEHOLDER_HINT}</p>
        {errors.message ? <p className="text-xs text-danger" role="alert">{errors.message}</p> : null}
      </div>
      <ThemePicker name={`${id}-theme`} value={value.theme} onChange={(t) => set('theme', t)} />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink">Icon</legend>
        <div className="flex flex-wrap gap-2">
          {APPRECIATION_ICONS.map((i) => (
            <label key={i} title={ICON_LABEL[i]} className={`grid h-11 w-11 cursor-pointer place-items-center rounded-xl border text-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--c-brand-text))] ${value.icon === i ? 'border-brand bg-brand/10 ring-2 ring-brand/30' : 'border-line'}`}>
              <input type="radio" name={`${id}-icon`} value={i} checked={value.icon === i} onChange={() => set('icon', i)} className="sr-only" aria-label={ICON_LABEL[i]} />
              <AppreciationIconSvg icon={i} size={20} />
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={`${id}-animation`}>Animation</FieldLabel>
        <select id={`${id}-animation`} className={fieldClass(false)} value={value.animation} onChange={(e) => set('animation', e.target.value as AppreciationAnimation)}>
          {APPRECIATION_ANIMATIONS.map((a) => (
            <option key={a} value={a}>{ANIMATION_LABEL[a]}</option>
          ))}
        </select>
        <p className="text-xs text-ink-2">Plays once on each device; never for people who ask for less motion.</p>
      </div>
    </div>
  );
}

const PICK = `relative inline-flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm ${TOUCH_SQUARE} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[rgb(var(--c-brand-text))]`;
/** The Custom choice's first colour (the owner's example). */
export const DEFAULT_CUSTOM: CustomColour = '#1e6091';
export const COLOUR_CODE_ERROR = 'Type a colour code like #1E6091 (# and six letters or numbers, 0–9 and A–F).';
/** 1.24.4: said with the reason, after the box goes back to the colour in use (what is shown is what is sent). */
const keptWords = (c: CustomColour) => `Kept ${c.toUpperCase()}.`;

/**
 * The colour theme: fourteen named ones, or (1.24.4) Custom — any colour from the device's colour picker, or a
 * typed code like #1E6091. A code being typed that isn't a colour yet keeps the last good colour and says why.
 */
function ThemePicker({ name, value, onChange }: { name: string; value: AppreciationContent['theme']; onChange: (t: AppreciationContent['theme']) => void }) {
  const id = useId();
  const custom = isCustomColour(value);
  // The last custom colour, kept while a named theme is tried, so Custom brings it back.
  const [lastCustom, setLastCustom] = useState<CustomColour>(custom ? (value.toLowerCase() as CustomColour) : DEFAULT_CUSTOM);
  const [code, setCode] = useState<string>(custom ? value.toUpperCase() : DEFAULT_CUSTOM.toUpperCase());
  const [bad, setBad] = useState(false);
  // A template picked (or the form reset) brings its own colour: show it in the boxes.
  useEffect(() => {
    if (!isCustomColour(value)) return;
    const v = value.toLowerCase() as CustomColour;
    setLastCustom(v);
    setCode((c) => (normaliseColourInput(c) === v ? c : v.toUpperCase()));
    setBad(false);
  }, [value]);
  const pick = (v: CustomColour) => {
    setLastCustom(v);
    setBad(false);
    onChange(v);
  };
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-ink">Colour theme</legend>
      <div className="flex flex-wrap gap-2" data-theme-picker>
        {APPRECIATION_THEMES.map((t) => (
          <label key={t} className={`${PICK} ${value === t ? 'border-brand ring-2 ring-brand/30' : 'border-line'}`}>
            <input type="radio" name={name} value={t} checked={value === t} onChange={() => onChange(t)} className="sr-only" />
            <span aria-hidden="true" className="h-5 w-5 rounded-full" style={{ backgroundImage: themeGradient(t) }} />
            {THEME_LOOK[t].label}
          </label>
        ))}
        <label className={`${PICK} ${custom ? 'border-brand ring-2 ring-brand/30' : 'border-line'}`}>
          <input type="radio" name={name} value="custom" checked={custom} onChange={() => onChange(lastCustom)} className="sr-only" />
          <span
            aria-hidden="true"
            className="h-5 w-5 rounded-full"
            style={{ backgroundImage: custom ? themeGradient(value) : 'conic-gradient(#b91c1c, #b45309, #4d7c0f, #0f766e, #1d4ed8, #6d28d9, #b91c1c)' }}
          />
          Custom
        </label>
      </div>
      {custom ? (
        <div className="mt-2 flex flex-wrap items-start gap-3" data-custom-colour>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-pick`} className="text-xs font-medium text-ink-2">Pick a colour</label>
            <input
              id={`${id}-pick`}
              type="color"
              value={lastCustom}
              onChange={(e) => {
                const v = normaliseColourInput(e.target.value);
                if (!v) return;
                setCode(v.toUpperCase());
                pick(v);
              }}
              className="h-11 w-16 cursor-pointer rounded-xl border border-line bg-surface p-1"
            />
          </div>
          <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
            <label htmlFor={`${id}-code`} className="text-xs font-medium text-ink-2">Or type a colour code</label>
            <input
              id={`${id}-code`}
              className={fieldClass(bad, 'font-mono uppercase')}
              value={code}
              maxLength={9}
              spellCheck={false}
              autoComplete="off"
              placeholder="#1E6091"
              aria-describedby={bad ? `${id}-code-error` : undefined}
              onChange={(e) => {
                setCode(e.target.value);
                const v = normaliseColourInput(e.target.value);
                // Said on leaving the box (not at every key while it is being typed); gone once it is a colour.
                if (v) pick(v);
              }}
              onBlur={() => {
                // Not a colour: the box goes back to the colour in use (what is shown is what will be sent) and says why.
                if (normaliseColourInput(code)) return;
                setCode(lastCustom.toUpperCase());
                setBad(true);
              }}
            />
            {bad ? (
              <p id={`${id}-code-error`} className="text-xs text-danger" role="alert">
                {COLOUR_CODE_ERROR} {keptWords(lastCustom)}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

/** What the person will see: the banner, filled in for one example person. */
export function AppreciationPreview({ value, name, company, day, sender }: { value: AppreciationContent; name: string; company: { name: string; logoUrl: string | null }; day: string; sender: string }) {
  return (
    <div className="ap-band relative overflow-hidden rounded-2xl px-5 py-4" style={themeStyle(value.theme)} data-appreciation-preview>
      <div className="relative flex items-start gap-3">
        <CompanyMark company={company} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ap-ink-90">
            <AppreciationIconSvg icon={value.icon} size={14} />
            Preview · {dayWords(day)}
          </p>
          <p dir="auto" className="font-display text-lg font-extrabold">{value.title || 'Title'}</p>
          <p dir="auto" className="mt-1 whitespace-pre-line text-sm">{fillPlaceholders(value.message || 'Message', { name, company: company.name, day })}</p>
          <p className="mt-1.5 text-xs ap-ink-90">From <bdi className="font-semibold">{sender}</bdi></p>
        </div>
      </div>
    </div>
  );
}

/** A form window (Edit, the template editor). */
export function FormDialog({ title, children, footer, onClose }: { title: string; children: ReactNode; footer: ReactNode; onClose: () => void }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const id = useId();
  return (
    <ModalPortal>
      <div className={dialogLayer('form')}>
        <div className="absolute inset-0 bg-scrim animate-fade-in" onClick={onClose} aria-hidden="true" />
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={`card relative flex flex-col ${dialogPanel('form')} animate-scale-in`}>
          <h2 id={id} className="border-b border-line px-5 py-4 font-display text-lg font-semibold text-ink">{title}</h2>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>
        </div>
      </div>
    </ModalPortal>
  );
}
