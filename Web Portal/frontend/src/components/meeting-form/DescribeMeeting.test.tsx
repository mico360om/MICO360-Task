import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DescribeMeeting, type DescribedMeetingFields } from './DescribeMeeting';
import { WriteDescription } from './WriteDescription';
import type { AiMeetingDraft } from '../../api/ai';
import { ApiError } from '../../lib/api-client';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { timeZone: 'Asia/Muscat' } }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const blank: DescribedMeetingFields = { title: '', description: '', start: '2026-10-22T09:00', end: '', rule: null, projectId: '', location: '', onlineLink: '' };
const draft = (extra: Partial<AiMeetingDraft> = {}): AiMeetingDraft => ({
  title: 'Weekly site review',
  description: null,
  date: '2026-10-26',
  startTime: '10:00',
  minutes: 90,
  recurrence: null,
  project: { id: 'p4', code: 'PUMP', number: 'PDO-2026-020', name: 'Pump Station Upgrade' },
  location: 'Rig 1 site office',
  onlineLink: null,
  people: { found: [{ id: 'u2', name: 'Sara Al Balushi' }], choices: [], notFound: [] },
  guests: [{ email: 'sami.k@contractor.om', name: 'sami.k' }],
  agenda: ['Pump test results'],
  ...extra,
});

function renderIt(opts: { answer?: AiMeetingDraft | Error; current?: Partial<DescribedMeetingFields>; withPeopleAndAgenda?: boolean } = {}) {
  const onApply = vi.fn();
  const onParse = vi.fn(async () => {
    if (opts.answer instanceof Error) throw opts.answer;
    return opts.answer ?? draft();
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DescribeMeeting
        onParse={onParse}
        current={{ ...blank, ...opts.current }}
        initial={blank}
        onApply={onApply}
        withPeopleAndAgenda={opts.withPeopleAndAgenda ?? true}
        projects={[{ id: 'p4', name: 'Pump Station Upgrade', code: 'PUMP', number: 'PDO-2026-020' }]}
        people={[]}
        repeatText={() => 'Repeats every week on Mon'}
      />
    </QueryClientProvider>,
  );
  return { onApply, onParse };
}
async function describeIt(sentence = 'Weekly site review Monday 10am for 90 minutes with Sara and sami.k@contractor.om') {
  await userEvent.type(screen.getByLabelText('Describe the meeting'), sentence);
  await userEvent.click(screen.getByRole('button', { name: 'Fill meeting details' }));
  return screen.findByRole('group', { name: 'Suggested details' });
}

describe('Describe the meeting', () => {
  it('nothing changes before Apply', async () => {
    const { onApply, onParse } = renderIt();
    const found = await describeIt();
    expect(onParse).toHaveBeenCalledWith('Weekly site review Monday 10am for 90 minutes with Sara and sami.k@contractor.om');
    expect(onApply).not.toHaveBeenCalled();
    for (const name of [/title: weekly site review/i, /when: .*26/i, /length: 90 minutes/i, /project: pump station upgrade/i, /location: rig 1 site office/i, /person: sara al balushi/i, /guest: sami\.k/i, /agenda: pump test results/i]) {
      expect(within(found).getByRole('checkbox', { name })).toBeChecked();
    }
    await userEvent.click(within(found).getByRole('checkbox', { name: /location/i }));
    await userEvent.click(within(found).getByRole('button', { name: 'Use selected details' }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0]).toEqual({
      title: 'Weekly site review',
      start: '2026-10-26T10:00',
      minutes: 90,
      projectId: 'p4',
      people: [{ kind: 'user', id: 'u2', name: 'Sara Al Balushi' }, { kind: 'guest', email: 'sami.k@contractor.om', name: 'sami.k' }],
      agenda: ['Pump test results'],
    });
    expect(screen.queryByRole('group', { name: 'Suggested details' })).not.toBeInTheDocument();
  });

  it('a suggestion that would replace your own value starts unticked', async () => {
    renderIt({ current: { title: 'My own title', location: 'Room 2' } });
    const found = await describeIt();
    expect(within(found).getByRole('checkbox', { name: /title: weekly site review/i })).not.toBeChecked();
    expect(found).toHaveTextContent('Replaces “My own title”');
    expect(within(found).getByRole('checkbox', { name: /location/i })).not.toBeChecked();
    expect(within(found).getByRole('checkbox', { name: /when/i })).toBeChecked(); // the start was never yours
  });

  it('a name with two matches asks which person', async () => {
    const { onApply } = renderIt({
      answer: draft({ people: { found: [], choices: [{ said: 'Omar', options: [{ id: 'u4', name: 'Omar Al Rawahi' }, { id: 'u5', name: 'Omar Said' }] }], notFound: ['Zainab'] }, guests: [], agenda: [] }),
    });
    const found = await describeIt('pump test with Omar and Zainab');
    const which = within(found).getByRole('radiogroup', { name: 'Which Omar?' });
    expect(within(which).getByRole('radio', { name: 'Neither' })).toBeChecked();
    expect(found).toHaveTextContent('Not found: Zainab');
    await userEvent.click(within(which).getByRole('radio', { name: 'Omar Said' }));
    await userEvent.click(within(found).getByRole('button', { name: 'Use selected details' }));
    expect(onApply.mock.calls[0]![0].people).toEqual([{ kind: 'user', id: 'u5', name: 'Omar Said' }]);
  });

  it('people with the same name are told apart by their username', async () => {
    const { onApply } = renderIt({
      answer: draft({
        people: { found: [], choices: [{ said: 'سارة', options: [{ id: 'u6', name: 'سارة Al Balushi', username: 'sara_6c14bb' }, { id: 'u7', name: 'سارة Al Balushi', username: 'sara_817ab4' }] }], notFound: [] },
        guests: [],
        agenda: [],
      }),
    });
    const found = await describeIt('review with سارة');
    const which = within(found).getByRole('radiogroup', { name: 'Which سارة?' });
    await userEvent.click(within(which).getByRole('radio', { name: /@sara_817ab4/ }));
    expect(within(which).getByRole('radio', { name: /@sara_6c14bb/ })).not.toBeChecked();
    await userEvent.click(within(found).getByRole('button', { name: 'Use selected details' }));
    expect(onApply.mock.calls[0]![0].people).toEqual([{ kind: 'user', id: 'u7', name: 'سارة Al Balushi' }]);
  });

  it('editing offers no people or agenda', async () => {
    renderIt({ withPeopleAndAgenda: false });
    const found = await describeIt();
    expect(within(found).queryByRole('checkbox', { name: /person|guest|agenda/i })).not.toBeInTheDocument();
    expect(within(found).getByRole('checkbox', { name: /title/i })).toBeInTheDocument();
  });

  it('AI not configured: says so, and the form is left as it was', async () => {
    const { onApply } = renderIt({ answer: new ApiError(400, 'VALIDATION', 'AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.') });
    await userEvent.type(screen.getByLabelText('Describe the meeting'), 'sync tomorrow');
    await userEvent.click(screen.getByRole('button', { name: 'Fill meeting details' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI is not configured yet');
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('Write description', () => {
  it('offers a replacement you can decline', async () => {
    const onUse = vi.fn();
    const onWrite = vi.fn(async () => 'Monthly review of the pump station: test results and next steps.');
    render(<WriteDescription current="My own words" onWrite={onWrite} onUse={onUse} disabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Write description' }));
    const offer = await screen.findByRole('group', { name: 'Suggested description' });
    expect(offer).toHaveTextContent('Monthly review of the pump station');
    expect(offer).toHaveTextContent('Replaces your description');
    await userEvent.click(within(offer).getByRole('button', { name: 'Keep mine' }));
    expect(onUse).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Suggested description' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Write description' }));
    await userEvent.click(within(await screen.findByRole('group', { name: 'Suggested description' })).getByRole('button', { name: 'Use this description' }));
    expect(onUse).toHaveBeenCalledWith('Monthly review of the pump station: test results and next steps.');
  });

  it('says what went wrong, e.g. AI not configured', async () => {
    const onWrite = vi.fn(async () => {
      throw new ApiError(400, 'VALIDATION', 'AI is not configured yet — an admin needs to add a provider and enable a chat model in AI Management.');
    });
    render(<WriteDescription current="" onWrite={onWrite} onUse={vi.fn()} disabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Write description' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI is not configured yet');
  });
});
