import { ApiError } from '../lib/api-client';
import { fileNameFromDisposition } from '../lib/download';
import type { FinalMinutesContent } from './meetings';
import type { ClientInspection } from './inspections';

export type { ClientInspection };

/**
 * The client page's own API: a client following one shared project, with no MICO360 account. It
 * sends the private link in a header and the device's session as its (httpOnly) cookie, and never
 * a staff token — the staff app's API client isn't used here at all.
 */

const DEFAULT_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

export interface ClientViewItem {
  title: string;
  /** 'Not started' | 'In progress' | 'In review' | 'On hold' | 'Done'. */
  status: string;
  /** 'YYYY-MM-DD'. */
  dueDate: string | null;
}

export interface ClientViewMinutes {
  id: string;
  title: string;
  date: string;
  approvedOn: string | null;
  content: FinalMinutesContent;
}

export interface ClientView {
  viewer: { name: string; email: string };
  project: {
    name: string;
    code: string;
    number: string | null;
    clientName: string | null;
    status: string;
    statusLabel: string;
    color: string;
    icon: string | null;
    imageUrl: string | null;
  };
  progress: { percentDone: number };
  timeline: { startDate: string | null; targetDate: string | null; today: string; elapsedPercent: number | null };
  milestones: ClientViewItem[];
  tasks: ClientViewItem[];
  minutes: ClientViewMinutes[];
  /** Finished inspection reports someone who runs the project marked "Show to client" (an older server sends none). */
  inspections?: ClientInspection[];
  generatedAt: string;
}

async function errorOf(res: Response): Promise<ApiError> {
  let code = 'ERROR';
  let message = `Request failed (${res.status})`;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, code, message);
}

export function clientViewApi(link: string, opts: { baseUrl?: string; fetch?: typeof fetch } = {}) {
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, '');
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  async function send(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    const hasBody = init.body !== undefined;
    const res = await doFetch(`${base}/client${path}`, {
      method: init.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'X-Client-Link': link, ...(hasBody ? { 'Content-Type': 'application/json' } : {}) },
      ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!res.ok) throw await errorOf(res);
    return res;
  }

  return {
    view: async (): Promise<ClientView> => ((await (await send('/view')).json()) as { data: ClientView }).data,
    requestCode: async (email: string): Promise<void> => {
      await send('/code', { method: 'POST', body: { email } });
    },
    verify: async (email: string, code: string): Promise<void> => {
      await send('/verify', { method: 'POST', body: { email, code } });
    },
    signOut: async (): Promise<void> => {
      await send('/sign-out', { method: 'POST' });
    },
    minutesPdf: async (meetingId: string): Promise<{ blob: Blob; fileName: string }> => {
      const res = await send(`/minutes/${encodeURIComponent(meetingId)}/pdf`);
      return { blob: await res.blob(), fileName: fileNameFromDisposition(res.headers.get('Content-Disposition')) ?? 'minutes.pdf' };
    },
    inspectionPdf: async (inspectionId: string): Promise<{ blob: Blob; fileName: string }> => {
      const res = await send(`/inspections/${encodeURIComponent(inspectionId)}/pdf`);
      return { blob: await res.blob(), fileName: fileNameFromDisposition(res.headers.get('Content-Disposition')) ?? 'inspection-report.pdf' };
    },
  };
}

export type ClientViewApi = ReturnType<typeof clientViewApi>;
