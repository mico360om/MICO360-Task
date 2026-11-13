/**
 * The starter list of Oman's public holidays each company gets (owner, 11 Nov: "a starter list + admin
 * edits", this year and next). The Islamic holidays follow the moon, so their dates here are the
 * expected ones (Umm al-Qura estimates) and are marked `expected`: the panel shows "Confirm" and a
 * banner as each comes near, and admins move them to the announced day. Admins can change or remove
 * any of them and add their own days off. Later releases add the following years. Accession Day (11 January,
 * owner 13 Nov 2026) is a fixed date like National Day; sites set up before it get it once (accession-day.ts).
 */
export interface StarterHoliday {
  day: string;
  name: string;
  /** An Islamic holiday whose date is announced nearer the time. */
  expected: boolean;
}

export const OMAN_STARTER_HOLIDAYS: readonly StarterHoliday[] = [
  // 2026
  { day: '2026-01-11', name: 'Accession Day', expected: false },
  { day: '2026-01-16', name: "Isra'a and Mi'raj", expected: true },
  { day: '2026-03-19', name: 'Eid al-Fitr', expected: true },
  { day: '2026-03-20', name: 'Eid al-Fitr', expected: true },
  { day: '2026-03-21', name: 'Eid al-Fitr', expected: true },
  { day: '2026-03-22', name: 'Eid al-Fitr', expected: true },
  { day: '2026-05-26', name: 'Arafat Day', expected: true },
  { day: '2026-05-27', name: 'Eid al-Adha', expected: true },
  { day: '2026-05-28', name: 'Eid al-Adha', expected: true },
  { day: '2026-05-29', name: 'Eid al-Adha', expected: true },
  { day: '2026-06-16', name: 'Islamic New Year', expected: true },
  { day: '2026-08-25', name: "Prophet's Birthday", expected: true },
  { day: '2026-11-20', name: 'National Day', expected: false },
  { day: '2026-11-21', name: 'National Day', expected: false },
  // 2027
  { day: '2027-01-05', name: "Isra'a and Mi'raj", expected: true },
  { day: '2027-01-11', name: 'Accession Day', expected: false },
  { day: '2027-03-08', name: 'Eid al-Fitr', expected: true },
  { day: '2027-03-09', name: 'Eid al-Fitr', expected: true },
  { day: '2027-03-10', name: 'Eid al-Fitr', expected: true },
  { day: '2027-03-11', name: 'Eid al-Fitr', expected: true },
  { day: '2027-05-15', name: 'Arafat Day', expected: true },
  { day: '2027-05-16', name: 'Eid al-Adha', expected: true },
  { day: '2027-05-17', name: 'Eid al-Adha', expected: true },
  { day: '2027-05-18', name: 'Eid al-Adha', expected: true },
  { day: '2027-06-06', name: 'Islamic New Year', expected: true },
  { day: '2027-08-14', name: "Prophet's Birthday", expected: true },
  { day: '2027-11-20', name: 'National Day', expected: false },
  { day: '2027-11-21', name: 'National Day', expected: false },
];

/** The starter holidays of these years (this year and next, when a company is set up). */
export function starterHolidaysFor(years: readonly number[]): StarterHoliday[] {
  return OMAN_STARTER_HOLIDAYS.filter((h) => years.includes(Number(h.day.slice(0, 4))));
}
