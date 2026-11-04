import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompanyTickList, type TickListCompany } from './CompanyTickList';

const co = (id: string, name: string, extra: Partial<TickListCompany> = {}): TickListCompany => ({ id, name, code: id.toUpperCase(), logoUrl: null, status: 'ACTIVE', ...extra });
const SEVEN = [
  co('ps', 'Prolens Projects LLC'),
  co('ah', 'Al Habsi Engineering & Contracting Services LLC'),
  co('oo', 'Oman Offshore Inspection and Integrity Management Company'),
  co('mi', 'Muscat Industrial Maintenance Solutions SAOC'),
  co('sp', 'Sohar Port Logistics & Marine Works LLC', { code: 'SPLX' }),
  co('al', 'Alpha Co'),
  co('be', 'Beta Co'),
];

function Many({ initial = [] as string[], companies = SEVEN, onChange = vi.fn() }) {
  const [value, setValue] = useState(initial);
  return (
    <CompanyTickList
      legend="Companies"
      companies={companies}
      value={value}
      onChange={(ids) => {
        setValue(ids);
        onChange(ids);
      }}
    />
  );
}
const names = () => within(screen.getByRole('group', { name: 'Companies' })).getAllByRole('checkbox').map((b) => b.getAttribute('aria-label') ?? b.closest('label')!.textContent);

describe('CompanyTickList', () => {
  it('one company per line with its whole name — never cut off', () => {
    render(<Many />);
    const list = screen.getByRole('list', { name: 'Companies' });
    expect(list.className).not.toMatch(/grid-cols-2/);
    const row = screen.getByRole('checkbox', { name: 'Oman Offshore Inspection and Integrity Management Company' }).closest('label')!;
    expect(row.innerHTML).not.toMatch(/\btruncate\b/);
    expect(row.textContent).toContain('Oman Offshore Inspection and Integrity Management Company');
  });

  it('the ticked ones first (A–Z), then the rest (A–Z)', () => {
    render(<Many initial={['sp', 'be']} />);
    expect(names()).toEqual([
      'Beta Co',
      'Sohar Port Logistics & Marine Works LLC',
      'Al Habsi Engineering & Contracting Services LLC',
      'Alpha Co',
      'Muscat Industrial Maintenance Solutions SAOC',
      'Oman Offshore Inspection and Integrity Management Company',
      'Prolens Projects LLC',
    ]);
  });

  it('ticking or unticking does not move the rows under the pointer', async () => {
    const onChange = vi.fn();
    render(<Many initial={['be']} onChange={onChange} />);
    const before = names();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Prolens Projects LLC' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Beta Co' }));
    expect(onChange).toHaveBeenLastCalledWith(['ps']);
    expect(names()).toEqual(before);
  });

  it('more than 6: a search box finds a company by part of its name or its code; the ticks stay', async () => {
    const onChange = vi.fn();
    render(<Many initial={['al']} onChange={onChange} />);
    const search = screen.getByRole('searchbox', { name: 'Search companies' });
    await userEvent.type(search, 'oman');
    expect(names()).toEqual(['Oman Offshore Inspection and Integrity Management Company']);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Oman Offshore Inspection and Integrity Management Company' }));
    expect(onChange).toHaveBeenLastCalledWith(['al', 'oo']);
    await userEvent.clear(search);
    await userEvent.type(search, 'splx');
    expect(names()).toEqual(['Sohar Port Logistics & Marine Works LLC']);
    await userEvent.clear(search);
    await userEvent.type(search, 'zzz');
    expect(screen.getByText('No company matches “zzz”.')).toBeInTheDocument();
    await userEvent.clear(search);
    expect(screen.getByRole('checkbox', { name: 'Alpha Co' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Oman Offshore Inspection and Integrity Management Company' })).toBeChecked();
  });

  it('6 or fewer: no search box', () => {
    render(<Many companies={SEVEN.slice(0, 6)} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('an archived company says so', () => {
    render(<Many initial={['be']} companies={[co('al', 'Alpha Co'), co('be', 'Beta Co', { status: 'ARCHIVED' })]} />);
    expect(screen.getByRole('checkbox', { name: 'Beta Co (archived)' })).toBeChecked();
  });

  it('a touch screen gets 44px rows (the ! form beats the base 32px rule)', () => {
    render(<Many />);
    const row = screen.getByRole('checkbox', { name: 'Alpha Co' }).closest('label')!;
    expect(row.className).toMatch(/\[@media\(pointer:coarse\)\]:!min-h-11/);
  });

  it('one of them (round buttons): picks a single company', async () => {
    const onChange = vi.fn();
    function One() {
      const [value, setValue] = useState<string[]>([]);
      return <CompanyTickList single legend="Company" companies={SEVEN} value={value} onChange={(ids) => { setValue(ids); onChange(ids); }} />;
    }
    render(<One />);
    await userEvent.click(screen.getByRole('radio', { name: 'Beta Co' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Alpha Co' }));
    expect(onChange).toHaveBeenLastCalledWith(['al']);
    expect(screen.getByRole('radio', { name: 'Beta Co' })).not.toBeChecked();
    expect(screen.getByRole('searchbox', { name: 'Search companies' })).toBeInTheDocument();
  });
});
