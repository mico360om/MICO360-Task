import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { appSource as src, hasWeb, readWeb } from '../testing/web-source';

/** The top-level statements of a TypeScript file's text, read with TypeScript's parser. */
const statements = (text: string) => ts.createSourceFile('x.ts', text, ts.ScriptTarget.Latest, true).statements;

/**
 * The property names of `interface <name> { … }` (its own braces, not what it extends) or
 * `type <name> = { … }` in a file's text, in order — comments and nested object types change nothing.
 * Empty when the file has no such type.
 */
function fieldsOf(text: string, name: string): string[] {
  for (const st of statements(text)) {
    const members =
      ts.isInterfaceDeclaration(st) && st.name.text === name ? st.members
      : ts.isTypeAliasDeclaration(st) && st.name.text === name && ts.isTypeLiteralNode(st.type) ? st.type.members
      : undefined;
    if (members) return members.map((m) => (m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : '')).filter(Boolean);
  }
  return [];
}

/** `type <name> = …` as written, spaces and line breaks collapsed ('' when there is none). */
function aliasText(text: string, name: string): string {
  const st = statements(text).find((s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === name);
  return st ? st.type.getText().replace(/\s+/g, ' ') : '';
}

const PAIRS = [
  ['frontend/src/api/tasks.ts', ['MoveProject', 'MoveTargets', 'MovePerson', 'TaskMovePreview', 'MovePreview', 'MoveInput', 'MoveResult', 'BulkMoveResult', 'ApprovalTask']],
  ['frontend/src/api/projects.ts', ['ProjectStats', 'ProjectPerson', 'ProjectOverview']],
  ['frontend/src/api/templates.ts', ['TaskTemplate']],
  ['frontend/src/api/users.ts', ['WelcomeOutcome', 'WelcomeBatchResult']],
] as const;

describe.skipIf(!hasWeb(...PAIRS.map(([f]) => f)))('the app’s copies of the website’s answers', () => {
  it('have the website’s field names', () => {
    const app = src('lib/types.ts') + src('lib/users-admin.ts');
    for (const [file, names] of PAIRS) {
      const web = readWeb(file);
      for (const n of names) {
        expect(fieldsOf(web, n).length, `${n} in ${file}`).toBeGreaterThan(0);
        // 1.23.6 (website only): a sent invitation also says when its link ends; the app keeps its copy
        // until its own update.
        const websiteOnly = n === 'WelcomeOutcome' ? ['expiresAt'] : [];
        expect(fieldsOf(app, n), n).toEqual(fieldsOf(web, n).filter((f) => !websiteOnly.includes(f)));
      }
    }
  });

  it('the move choice and a bulk move’s result rows are written as the website writes them', () => {
    const web = readWeb('frontend/src/api/tasks.ts');
    for (const n of ['AssigneeChoice', 'BulkMoveItem']) {
      expect(aliasText(web, n), n).not.toBe('');
      expect(aliasText(src('lib/types.ts'), n), n).toBe(aliasText(web, n));
    }
  });

  it('the approvals answer is the website’s { canApprove, tasks }', () => {
    expect(readWeb('frontend/src/api/tasks.ts')).toMatch(/approvals: \(\) => client\.get<\{ data: \{ canApprove: boolean; tasks: ApprovalTask\[\] \} \}>\('\/tasks\/approvals'\)/);
    expect(fieldsOf(src('lib/types.ts'), 'ApprovalsAnswer')).toEqual(['canApprove', 'tasks']);
  });

  it('ApiTask and ApiProject carry the fields Stage 2 reads', () => {
    // …and who may delete it (task-delete-rule): its creator, and the server's answer for this person.
    const TASK = ['formerKeys', 'clientVisible', 'inspectionFormId', 'inspectionPlace', 'createdById', 'canDelete', 'canDeleteSeries'];
    const PROJECT = ['carryForward', 'defaultDueToday', 'newTasksNeedApproval'];
    for (const f of TASK) expect(fieldsOf(readWeb('frontend/src/api/tasks.ts'), 'ApiTask'), f).toContain(f);
    for (const f of PROJECT) expect(fieldsOf(readWeb('frontend/src/api/projects.ts'), 'ApiProject'), f).toContain(f);
    expect(fieldsOf(src('lib/types.ts'), 'ApiTask')).toEqual(expect.arrayContaining(TASK));
    expect(fieldsOf(src('lib/types.ts'), 'ApiProject')).toEqual(expect.arrayContaining(PROJECT));
  });

  it('an administrator’s list of people carries the last sign-in and the last welcome email', () => {
    const USER = ['lastLoginAt', 'welcomeSentAt'];
    expect(fieldsOf(readWeb('frontend/src/api/users.ts'), 'ApiUser')).toEqual(expect.arrayContaining(USER));
    expect(fieldsOf(src('lib/users-admin.ts'), 'ApiAdminUser')).toEqual(expect.arrayContaining(USER));
  });
});
// (ProjectOverview's Pick<…> part is checked by the ApiProject test; fieldsOf reads only the braces.)

// Final review A3: an answer from the offline copy is out of date at once (the query client's rule), a server's for 30 s.
it('reads approvals through the offline copy, refreshed every 30 s — at once when the copy answered', () =>
  expect(src('core/approval-queries.ts')).toMatch(/queryKey: APPROVALS_KEY[^]*reads\.read\(queryKey, 'approvals', \(\) => resources\.tasks\.approvals\(\)\)[^]*staleTime: \(q\) => \(reads\.answeredFromCopy\(q\) \? 0 : 30_000\)/));

it('My Tasks can be opened on its To approve section', () =>
  expect(src('navigation/types.ts')).toMatch(/MyTasks: \{ show\?: 'to-approve' \} \| undefined;/));
