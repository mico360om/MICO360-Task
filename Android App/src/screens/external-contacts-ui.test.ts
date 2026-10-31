import { it, expect, describe } from 'vitest';
import { appSource as src } from '../testing/web-source';

/** External contacts in the app: where each part of the feature is wired (the logic is tested in lib/). */
describe('the task screen’s External contacts card', () => {
  it('sits right after the details, apart from the assignees', () => {
    const s = src('screens/TaskDetailScreen.tsx');
    expect(s).toMatch(/withExternalContacts\(withTaskCards\(/);
    // An older server that knows nothing of external contacts sends none: no card then.
    expect(s).toMatch(/external: task\.externalContacts \? \(\s*<ExternalContactsCard/);
  });

  it('shows each contact’s name, company · designation, remarks, and email and phone as links that write and call', () => {
    const s = src('components/task-detail/ExternalContactsCard.tsx');
    expect(s).toMatch(/EXTERNAL_CONTACT_WORDS\.heading/);
    expect(s).toMatch(/contactRoleLine\(/);
    expect(s).toMatch(/Linking\.openURL\(mailHref\(/);
    expect(s).toMatch(/Linking\.openURL\(phoneHref\(/);
    expect(s).toMatch(/accessibilityRole="link"/);
    expect(s).toMatch(/c\.remarks/);
    expect(s).toMatch(/EXTERNAL_CONTACT_WORDS\.none/);
  });

  it('adds, edits and removes — removing asks first — and stops at the limit', () => {
    const s = src('components/task-detail/ExternalContactsCard.tsx');
    expect(s).toMatch(/EXTERNAL_CONTACT_WORDS\.add\b/);
    expect(s).toMatch(/editContactLabel\(/);
    expect(s).toMatch(/removeContactLabel\(/);
    expect(s).toMatch(/Alert\.alert\(EXTERNAL_CONTACT_WORDS\.confirmRemove/);
    expect(s).toMatch(/text: EXTERNAL_CONTACT_WORDS\.keep, style: 'cancel'/);
    expect(s).toMatch(/MAX_EXTERNAL_CONTACTS/);
    expect(s).toMatch(/EXTERNAL_CONTACT_WORDS\.full/);
  });
});

describe('the contact editor (the task screen and the task form)', () => {
  it('has the six fields with the website’s labels, checks them, and shows the server’s word for each field', () => {
    const s = src('components/task-form/ContactEditor.tsx');
    expect(s).toMatch(/const L = EXTERNAL_CONTACT_WORDS\.labels;/);
    for (const f of ['name', 'company', 'designation', 'email', 'phone', 'remarks']) expect(s, f).toMatch(new RegExp(`label=\\{L\\.${f}\\}`));
    expect(s).toMatch(/checkExternalContact\(/);
    expect(s).toMatch(/contactFieldProblems\(/);
    expect(s).toMatch(/keyboardType="email-address"/);
    expect(s).toMatch(/keyboardType="phone-pad"/);
    expect(s).toMatch(/EXTERNAL_CONTACT_LIMITS\.remarks/);
  });

  it('suggests earlier contacts of the project as the name is typed; picking one fills all six fields', () => {
    const s = src('components/task-form/ContactEditor.tsx');
    expect(s).toMatch(/useExternalContactSuggestions\(/);
    expect(s).toMatch(/suggestionText\(/);
    expect(s).toMatch(/EXTERNAL_CONTACT_WORDS\.suggestions/);
    expect(s).toMatch(/draftOf\(pick\)/);
  });
});

describe('the New task and Edit task form', () => {
  it('has an optional External contacts field; a new task sends them with the create', () => {
    const s = src('screens/NewTaskScreen.tsx');
    expect(s).toMatch(/<ExternalContactsField/);
    expect(s).toMatch(/externalContacts: contactInputs\(contacts\)/);
  });

  it('an edit saves the contacts that changed after the task’s own changes', () => {
    const s = src('screens/NewTaskScreen.tsx');
    expect(s).toMatch(/saveContactChanges\(/);
    expect(s).toMatch(/contactsDirty\(/);
  });
});

describe('cards and lists name the contacts; My Tasks and the boards filter by company', () => {
  it('board cards (a project’s and All projects), My Tasks and the project’s Tasks tab show the line', () => {
    expect(src('components/board/BoardCard.tsx')).toMatch(/view\.externalText/);
    expect(src('components/my-tasks/MyTaskItem.tsx')).toMatch(/externalContactsLine\(t\.externalSummary\)/);
    expect(src('components/project/TasksTab.tsx')).toMatch(/externalContactsLine\(task\.externalSummary\)/);
  });

  it('My Tasks, a project’s board and the All projects board offer the company filter', () => {
    const mine = src('screens/MyTasksScreen.tsx');
    expect(mine).toMatch(/externalCompanyOptions\(/);
    expect(mine).toMatch(/company: externalCompany/);
    for (const f of ['screens/BoardScreen.tsx', 'screens/AllBoardScreen.tsx']) {
      const s = src(f);
      expect(s, f).toMatch(/filterByExternalCompany\(/);
      expect(s, f).toMatch(/<ExternalCompanyFilter/);
    }
    expect(src('components/board/ExternalCompanyFilter.tsx')).toMatch(/EXTERNAL_CONTACT_WORDS\.filter/);
  });
});
