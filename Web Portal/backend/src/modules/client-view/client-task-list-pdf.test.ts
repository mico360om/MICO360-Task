import { describe, it, expect } from 'vitest';
import { inspectPdf } from '../../lib/pdf-inspect';
import { buildClientTaskListPdf, type ClientTaskListPdfData } from './client-task-list-pdf';

const data: ClientTaskListPdfData = {
  brand: { productName: 'MICO360 Tasks', companyName: 'Prolens Projects LLC', websiteUrl: 'https://task.mico360.com', colors: { brand: '#8B1E1E' } },
  project: { name: 'Rig upgrade', code: 'RIG', number: 'C-77', clientName: 'Acme', color: '#8B1E1E', icon: null, image: null },
  percentDone: 40,
  milestones: [{ key: 'RIG-1', title: 'Kick-off', status: 'Done', dueDate: '2026-10-01', late: false, acceptedOn: '2026-10-02' }],
  tasks: [
    { key: 'RIG-4', title: 'Install pump', status: 'In progress', dueDate: '2026-10-29', late: true, acceptedOn: null },
    { key: 'RIG-5', title: 'Commission', status: 'Not started', dueDate: null, late: false, acceptedOn: null },
  ],
  timeZone: 'Asia/Muscat',
  generatedAt: '2026-10-30T08:00:00Z',
};

describe('The Client portal task list PDF', () => {
  it('prints the project, its progress and each shared task’s number, title, status, due day and acceptance', () => {
    const text = inspectPdf(buildClientTaskListPdf(data)).pages.flat().join('\n');
    for (const s of ['Rig upgrade', 'PROJECT PROGRESS', '40% DONE', 'RIG', 'C-77', 'Acme', 'Milestones', 'Kick-off', 'RIG-1', '2 Oct 2026', 'Tasks', 'RIG-4', 'Install pump', 'In progress (late)', '29 Oct 2026', 'RIG-5', 'Commission', 'Not started', 'Prolens Projects LLC']) {
      expect(text, s).toContain(s);
    }
  });

  it('says so when no task is shared', () => {
    const text = inspectPdf(buildClientTaskListPdf({ ...data, milestones: [], tasks: [] })).pages.flat().join('\n');
    expect(text).toContain('No tasks are shared with you yet.');
    expect(text).not.toContain('Milestones');
  });
});
