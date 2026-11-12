import type { StarterCourse, StarterLesson, StarterQuestion } from './starter-types';

/**
 * The starter courses (owner answer 3, ruling R17; simplified 12 Nov): "Getting started", then one short English
 * course per main module. Each opens with its training video (a lesson hidden from learners until an
 * administrator pastes the owner's YouTube / Vimeo link — R2, R4), then step-by-step guides with screenshots of the
 * real website, then a short quiz. Loaded once by training-starter.ts and brought up to date there for courses
 * nobody has edited (R1); the pictures and PDFs are in backend/assets/training/starter (the capture script is in
 * the lane ledger). Keys never change once shipped; a lesson's earlier titles are kept in `was`.
 */

/** Raised whenever this content changes, so sites update the starter courses nobody edited (R1). */
export const STARTER_REVISION = 2;

/** The starter keys 1.23.24 loaded (revision 1): a site that ran it has them, or an administrator deleted them. */
export const LEGACY_STARTER_KEYS: readonly string[] = [
  'starter:tasks',
  'starter:board',
  'starter:meetings',
  'starter:calendar',
  'starter:projects',
  'starter:reports',
  'starter:chat',
  'starter:mico-ai',
  'starter:admin',
  'starter:portal',
  'starter:video-tasks',
  'starter:video-meetings',
  'starter:video-minutes',
];

/**
 * R4: the 1.23.24 draft video courses. Their link (if one was added) goes into the module course's video lesson;
 * the course itself is removed when it has no link, was never edited and never published — and only when its
 * module course was brought up to date (else the video would have nowhere to go). Meetings gets one video.
 */
export const RETIRED_VIDEO_COURSES: readonly { key: string; into: string }[] = [
  { key: 'starter:video-tasks', into: 'starter:tasks' },
  { key: 'starter:video-meetings', into: 'starter:meetings' },
  { key: 'starter:video-minutes', into: 'starter:meetings' },
];

// ── Small helpers (every starter quiz: pass mark 70, unlimited retakes, shuffled, no time limit, no intro —
//    the quiz's own first line says how many questions and the pass mark) ─────────────────────────────

type Option = StarterQuestion['options'][number];

const right = (text: string, feedback?: string): Option => ({ text, correct: true, ...(feedback ? { feedback } : {}) });
const wrong = (text: string, feedback?: string): Option => ({ text, correct: false, ...(feedback ? { feedback } : {}) });

function single(prompt: string, options: Option[], explanation: string): StarterQuestion {
  return { kind: 'SINGLE', prompt, explanation, options };
}
function multiple(prompt: string, options: Option[], explanation: string): StarterQuestion {
  return { kind: 'MULTIPLE', prompt, explanation, options };
}
function trueFalse(prompt: string, answer: boolean, explanation: string): StarterQuestion {
  return { kind: 'TRUE_FALSE', prompt, explanation, options: [{ text: 'True', correct: answer }, { text: 'False', correct: !answer }] };
}
/** The steps in the right order (the quiz shuffles them). Kept for two quizzes only: the rest are single choice. */
function order(prompt: string, steps: string[], explanation: string): StarterQuestion {
  return { kind: 'ORDER', prompt, explanation, options: steps.map((text) => ({ text, correct: true })) };
}
function quiz(title: string, questions: StarterQuestion[], minutes = 3): StarterLesson {
  return { kind: 'QUIZ', title, minutes, quiz: { passMark: 70, maxAttempts: null, shuffle: true, timeLimitMinutes: null, drawCount: null, questions } };
}
/** The course's training video: hidden until the link is pasted (no words needed around it). */
const video = (title: string, minutes: number): StarterLesson => ({ kind: 'VIDEO', title, minutes, videoUrl: null });

// ── 0. Getting started ───────────────────────────────────────────────────────────────────────────

const gettingStarted: StarterCourse = {
  key: 'starter:getting-started',
  title: 'Getting started',
  summary: 'Sign in, find your way around, and keep up with your notices and settings.',
  moduleKey: 'general',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  position: -1,
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  lessons: [
    video('Video: Getting started', 2),
    {
      kind: 'GUIDE',
      title: 'Find your way around',
      minutes: 5,
      steps: [
        {
          title: 'Sign in',
          body: '<p>Type your email or username and your password, then click <strong>Sign in</strong>. The first time, you may be asked for a 6-digit code from your email and to choose your own password.</p>',
          image: 'start-sign-in.webp',
          alt: 'The sign-in page: the Email or username and Password boxes and the Sign in button.',
        },
        {
          title: 'Your Dashboard',
          body: '<p>You start on the <strong>Dashboard</strong>. <strong>My Priorities Today</strong> lists what needs you first, and why. <strong>Customize dashboard</strong> chooses what the page shows.</p>',
          image: 'start-dashboard.webp',
          alt: 'The Dashboard with My Priorities Today: tasks due today and overdue, each with the reason it is listed.',
        },
        {
          title: 'The side menu',
          body: '<p>Every part of the site is in the menu on the left: My Tasks, Kanban Board, Projects, Calendar, Meetings, Chat, MICO AI and more. On a phone, open it with the ☰ button.</p>',
          image: 'start-menu.webp',
          alt: 'The side menu: Dashboard, My Tasks, Kanban Board, Projects, Calendar, Meetings, Learning Hub, Chat, MICO AI and Notifications.',
        },
        {
          title: 'Search',
          body: '<p>Click the search box at the top, or press <strong>Ctrl+K</strong>, and type a few letters to find a task, a project or a person. Type a page’s name to go there.</p>',
          image: 'start-search.webp',
          alt: 'The search box open at the top of the page, with the tasks, projects and people that match the words typed.',
        },
        {
          title: 'Notifications',
          body: '<p>The bell at the top shows new notices: tasks given to you, mentions, reminders and answers. Click one to open what it is about.</p>',
          image: 'start-notifications.webp',
          alt: 'The notifications list open under the bell, with a task given to you and a mention.',
        },
        {
          title: 'Your settings',
          body: '<p>Click your picture at the top right and choose <strong>Settings</strong> to change your profile, password, notifications, and your week start and time zone.</p>',
          image: 'start-settings.webp',
          alt: 'The account menu open under the person’s picture, with Your profile, Settings, Keyboard shortcuts and Tour of the site.',
        },
        {
          title: 'The Learning Hub',
          body: '<p><strong>Learning Hub</strong> in the menu has a short course for each part of the site. <strong>Up next</strong> shows the one to do first. <strong>Tour of the site</strong>, in the same account menu, shows you around again.</p>',
        },
      ],
    },
    quiz(
      'Quiz: Getting started',
      [
        single(
          'Where do you find every part of the site?',
          [
            right('The side menu on the left', 'Yes — on a phone, open it with the ☰ button.'),
            wrong('The Dashboard', 'The Dashboard shows what to do first; the menu has every part.'),
            wrong('Settings', 'Settings are your own preferences.'),
            wrong('The bell', 'The bell shows your notices.'),
          ],
          'The side menu lists every part of the site.',
        ),
        single(
          'How do you open the search from any page?',
          [
            right('Press Ctrl+K', 'Yes — or click the search box at the top.'),
            wrong('Press Escape', 'Escape closes things.'),
            wrong('Open Settings', 'Settings don’t search.'),
            wrong('Open Chat', 'Chat searches only conversations.'),
          ],
          'Ctrl+K (or the search box at the top) finds tasks, projects and people.',
        ),
        trueFalse('The bell at the top shows your new notices.', true, 'Tasks given to you, mentions, reminders and answers arrive there.'),
      ],
      2,
    ),
  ],
};

// ── 1. Tasks ─────────────────────────────────────────────────────────────────────────────────────

const tasks: StarterCourse = {
  key: 'starter:tasks',
  title: 'Tasks basics',
  summary: 'Find the work assigned to you, add a new task, and keep it up to date: its status, checklist and comments.',
  moduleKey: 'tasks',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  resources: [{ file: 'tasks-how-to.pdf', name: 'Tasks how-to slides (PDF)', mimeType: 'application/pdf' }],
  lessons: [
    video('Video: Tasks', 2),
    {
      kind: 'GUIDE',
      title: 'Find and add tasks',
      minutes: 5,
      body: '<p>Everything you need to do is a task. In this lesson you find your tasks and add a new one.</p>',
      steps: [
        {
          title: 'Open My Tasks',
          body: '<p>In the side menu, click <strong>My Tasks</strong>. You see every task assigned to you, across all your projects.</p><p>The chips at the top — <strong>All</strong>, <strong>Open</strong>, <strong>Overdue</strong> and <strong>Completed</strong> — show how many tasks are in each group. Click one to show only those.</p>',
          image: 'tasks-my-tasks.webp',
          alt: 'The My Tasks page: the All, Open, Overdue and Completed chips, the filter boxes, and task cards with their project, status, due date and people.',
        },
        {
          title: 'Filter and sort the list',
          body: '<p>Use the boxes under the chips to show one project, a status, a priority, a person or a due date. <strong>Sort</strong> puts the list in order, for example by due date.</p><p>The small buttons on the right switch between the grid, list and table views.</p>',
        },
        {
          title: 'Start a new task',
          body: '<p>Click <strong>New Task</strong> at the top of any page (or press <strong>N</strong>). The <strong>New task</strong> window opens.</p>',
          image: 'tasks-new-task.webp',
          alt: 'The New task window with the Project, Column and Task title fields on the left, and Priority, Due date, Repeat and Assignees on the right.',
        },
        {
          title: 'Fill in the details',
          body: '<p>Pick the <strong>Project</strong> and type a <strong>Task title</strong> — the only thing you must fill in. Add a <strong>Due date</strong>, a <strong>Priority</strong> and the <strong>Assignees</strong> if you like.</p>',
        },
        {
          title: 'Save it',
          body: '<p>Click <strong>Create task</strong> (or press <strong>Ctrl+Enter</strong>). The task goes on the project’s board and into My Tasks for the people it is assigned to.</p>',
        },
      ],
    },
    {
      kind: 'GUIDE',
      title: 'Work on a task',
      minutes: 5,
      body: '<p>Keep each task up to date, so your team always knows where things stand.</p>',
      steps: [
        {
          title: 'Open a task',
          body: '<p>Click a task’s title. Its details open in a panel on the right: the description, checklists, comments and everything that happened to it.</p>',
          image: 'tasks-drawer.webp',
          alt: 'A task’s details panel: the title, description, a checklist with three steps, a comment from a colleague, and the Details box with status, priority, due date and assignees.',
        },
        {
          title: 'Change the status, priority or date',
          body: '<p>In <strong>Details</strong>, pick a new <strong>Status</strong> as the work moves on — for example from To Do to In Progress. You can also change the <strong>Priority</strong>, the <strong>Due date</strong>, the <strong>Repeat</strong> and the people under <strong>Assignees</strong>.</p>',
          image: 'tasks-details.webp',
          alt: 'The Details box of a task: Status To Do, Priority High, a due date, Repeat “Does not repeat” and two assignees.',
        },
        {
          title: 'Tick off checklist steps',
          body: '<p>Under <strong>Checklists</strong>, tick each step when it is done. The task’s progress follows the steps you tick.</p>',
        },
        {
          title: 'Write a comment',
          body: '<p>Type in the comment box and click <strong>Comment</strong> (or press <strong>Ctrl+Enter</strong>). Type <strong>@</strong> and a name to mention a colleague.</p>',
          image: 'tasks-comment.webp',
          alt: 'The Comments box with a reply being typed, the Comment button, and a colleague’s earlier comment below it.',
        },
        {
          title: 'Finish the task',
          body: '<p>When the work is done, set the <strong>Status</strong> to the project’s last column — <strong>Completed</strong> or <strong>Done</strong>, depending on the project. A task marked <strong>Needs approval</strong> waits for a project manager to approve it before it counts as done.</p>',
        },
      ],
    },
    quiz('Quiz: Tasks', [
      single(
        'Where do you see every task assigned to you, across all your projects?',
        [
          right('My Tasks', 'Yes — My Tasks lists your tasks from every project.'),
          wrong('Activity', 'Activity shows what changed recently, not your task list.'),
          wrong('Templates', 'Templates are ready-made tasks and projects, not your work.'),
          wrong('Notifications', 'Notifications tell you about changes; your tasks are in My Tasks.'),
        ],
        'My Tasks, in the side menu, shows everything assigned to you.',
      ),
      trueFalse('When you add a task, the task title is the only thing you must fill in.', true, 'Only the Task title is required. Everything else — description, due date, priority, people — is optional.'),
      multiple(
        'Which of these can you do in a task’s details panel?',
        [
          right('Change its status', 'Right — use Status in Details.'),
          right('Tick checklist steps', 'Right — tick each step under Checklists.'),
          right('Write a comment', 'Right — type in the comment box and click Comment.'),
          wrong('Change your own password', 'Your password is changed in Settings, not in a task.'),
        ],
        'The details panel holds the status, checklists and comments of the task.',
      ),
      single(
        'How do you add a task from any page?',
        [
          right('Click New Task at the top (or press N)', 'Yes — the New task window opens.'),
          wrong('Open Settings', 'Settings are your own preferences.'),
          wrong('Send a chat message', 'Chat doesn’t make tasks.'),
          wrong('Open the Calendar first', 'You can, but New Task works on every page.'),
        ],
        'New Task is at the top of every page; N opens it too.',
      ),
      single(
        'How do you mention a colleague in a comment?',
        [
          right('Type @ and then their name', 'Yes — type @ and pick the person.'),
          wrong('Write their name in capitals', 'Capitals don’t mention anyone. Type @ and the name.'),
          wrong('Add them under Assignees', 'That gives them the task; it doesn’t mention them in a comment.'),
          wrong('Send them a chat message', 'Chat is separate. In a comment, type @ and the name.'),
        ],
        'Type @ followed by the person’s name in the comment box.',
      ),
    ]),
  ],
};

// ── 2. Kanban board ──────────────────────────────────────────────────────────────────────────────

const board: StarterCourse = {
  key: 'starter:board',
  title: 'Kanban board basics',
  summary: 'See your project’s work as cards in columns, move cards as the work moves on, and look at a day or a whole month.',
  moduleKey: 'board',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  lessons: [
    video('Video: Kanban board', 2),
    {
      kind: 'GUIDE',
      title: 'Read the board',
      minutes: 5,
      body: '<p>The board shows a project’s tasks as cards. Each column is a stage of the work.</p>',
      steps: [
        {
          title: 'Open the board',
          body: '<p>Click <strong>Kanban Board</strong> in the side menu. Each column is a stage, such as To Do, In Progress and Review, and each card is a task.</p><p>If you work on more than one project, pick one at the top — or choose <strong>All projects</strong> to see them together.</p>',
          image: 'board-day.webp',
          alt: 'The Kanban Board with six columns — Backlog, To Do, In Progress, Waiting / Blocked, Review and Completed — and task cards in each.',
        },
        {
          title: 'One day at a time',
          body: '<p>The board shows one day — today, when you open it. Unfinished tasks from earlier days move on to today by themselves, so nothing gets lost. Use the arrows or the date box to look at another day.</p>',
        },
        {
          title: 'Read a card',
          body: '<p>A card shows the task number, title, priority, due date, checklist and comment counts, progress and the people on it. A red date means the task is overdue. Click a card to open the task.</p>',
        },
        {
          title: 'See the whole month',
          body: '<p>Click <strong>Month</strong> to see the month’s tasks by their start, due and finish dates. Click <strong>Day</strong> to go back to one day.</p>',
          image: 'board-month.webp',
          alt: 'The board in Month view, with more cards in each column and the month and year picker at the top.',
        },
        {
          title: 'Switch to a table',
          body: '<p>Click <strong>Table</strong> to see the same tasks as rows you can filter and sort. Click <strong>Board</strong> to see the cards again.</p>',
          image: 'board-table.webp',
          alt: 'The board as a table: one row per task with its number, title, assignees, priority, due date and status.',
        },
      ],
    },
    {
      kind: 'GUIDE',
      title: 'Move and add cards',
      minutes: 4,
      steps: [
        {
          title: 'Drag a card to the next stage',
          body: '<p>Drag a card to another column to change its status. Dropping it in the last column (<strong>Completed</strong> or <strong>Done</strong>) completes the task.</p>',
          image: 'board-drag.webp',
          alt: 'A card being dragged from the To Do column towards the In Progress column.',
        },
        {
          title: 'Use the keyboard',
          body: '<p>No mouse? Press <strong>Tab</strong> to reach a card, <strong>Space</strong> to pick it up, the arrow keys to move it and <strong>Space</strong> again to drop it. <strong>Escape</strong> cancels.</p>',
        },
        {
          title: 'Add a task to a column',
          body: '<p>Click <strong>+</strong> at the top of a column to add a task straight into it, or click <strong>+ New task</strong> at the top of the page.</p>',
        },
        {
          title: 'Change the columns',
          body: '<p>Project managers and administrators see <strong>Manage columns</strong>. There you can rename, reorder, hide or add columns, and choose the status each column stands for. Click <strong>Done</strong> when you finish.</p>',
          image: 'board-columns.webp',
          alt: 'The Columns panel: each column with its name, mapped status, a Visible switch and reorder arrows, and the Add a column box below.',
        },
      ],
    },
    quiz('Quiz: Kanban board', [
      single(
        'What happens when you drag a card to another column?',
        [
          right('The task’s status changes to that column', 'Yes — the column is the task’s stage.'),
          wrong('The task is copied', 'Nothing is copied; the same task moves.'),
          wrong('The task moves to another project', 'Moving between columns keeps it in the same project.'),
          wrong('The task is deleted', 'Dragging never deletes a task.'),
        ],
        'Each column is a status. Dropping a card in a column gives the task that status.',
      ),
      trueFalse('By default, unfinished tasks from earlier days move on to today’s board by themselves.', true, 'Unfinished work is carried forward to today, so it never gets lost on an old day.'),
      single(
        'How do you see the whole month’s tasks on the board?',
        [
          right('Click Month', 'Yes — Day goes back to one day.'),
          wrong('Click Table', 'Table shows the same tasks as rows.'),
          wrong('Open Settings', 'The board’s views are at its top.'),
          wrong('You can’t', 'Click Month.'),
        ],
        'Month shows the month’s tasks by their start, due and finish dates.',
      ),
      multiple(
        'Which of these does a card show?',
        [
          right('The due date', 'Right — red when it is overdue.'),
          right('The priority', 'Right — Low, Normal, High or Urgent.'),
          right('The people it is assigned to', 'Right — their initials are on the card.'),
          wrong('The project’s budget', 'Cards don’t show money.'),
        ],
        'A card shows the task number, title, priority, due date, counts, progress and people.',
      ),
      single(
        'Who can use Manage columns?',
        [
          right('Project managers and administrators', 'Yes — they can rename, reorder, hide and add columns.'),
          wrong('Everyone on the project', 'Only project managers and administrators see Manage columns.'),
          wrong('Clients', 'Clients never see the board.'),
          wrong('Nobody', 'Project managers and administrators can.'),
        ],
        'Manage columns is for project managers and administrators.',
      ),
    ]),
  ],
};

// ── 3. Meetings & minutes (as 1.23.24 has them: vlhub/meetings-1.23.24-facts.md) ─────────────────────

const meetings: StarterCourse = {
  key: 'starter:meetings',
  title: 'Meetings & minutes',
  summary: 'Schedule a meeting, invite people, take notes while it runs, turn actions into tasks, and send the final minutes.',
  moduleKey: 'meetings',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  resources: [{ file: 'meetings-how-to.pdf', name: 'Meetings how-to slides (PDF)', mimeType: 'application/pdf' }],
  lessons: [
    // One video for Meetings: start to finish (owner, 12 Nov) — no separate minutes video.
    video('Video: Meetings start to finish', 12),
    {
      kind: 'GUIDE',
      title: 'Plan a meeting',
      minutes: 5,
      steps: [
        {
          title: 'Open Meetings',
          body: '<p>Click <strong>Meetings</strong> in the side menu. <strong>Up next</strong> shows your next meeting, and the list groups meetings into Today, Next 7 days, Later, Drafts and Past.</p>',
          image: 'meetings-list.webp',
          alt: 'The Meetings page: the four counts, the Up next card for the next meeting, and meeting cards for today and the next 7 days.',
        },
        {
          title: 'Schedule a meeting',
          body: '<p>Click <strong>+ New meeting</strong>. In <strong>Schedule a meeting</strong>, type a <strong>Title</strong>, pick when it <strong>Starts</strong> and <strong>Ends</strong> (in company time), the <strong>Project</strong>, and the <strong>Location</strong> or an <strong>Online link</strong>. <strong>Repeat</strong> makes it a series.</p>',
          image: 'meetings-new.webp',
          alt: 'The Schedule a meeting window: Title, Starts, Ends, Repeat, Project, Location and Status on the left; Describe the meeting, Free times, People and Agenda on the right.',
        },
        {
          title: 'Add people and an agenda',
          body: '<p>Under <strong>People</strong>, add team members, or a guest by email. Under <strong>Agenda</strong>, add the topics. <strong>Free times</strong> suggests times that suit everyone. Then click <strong>Schedule meeting</strong>.</p>',
        },
        {
          title: 'Send the invitations',
          body: '<p>The meeting’s page opens. Nothing is sent until you click <strong>Send invitations</strong>, then <strong>Send to … people</strong>. Each person gets an email with a calendar file. Team members answer Accept, Maybe or Decline on the meeting’s page or in the Calendar.</p>',
          image: 'meetings-page.webp',
          alt: 'A scheduled meeting’s page: the Send invitations button, the Agenda with two topics, Live notes, and People with their answers.',
        },
      ],
    },
    {
      kind: 'GUIDE',
      title: 'Run the meeting and send the minutes',
      minutes: 6,
      body: '<p>The organizer, project managers and administrators run the meeting and send the minutes.</p>',
      steps: [
        {
          title: 'Take notes as you go',
          body: '<p>Click <strong>Start meeting</strong>. Under <strong>Live notes</strong>, pick the kind of note — Discussion, Decision, Action Item, Issue, Question or Information — write it and click <strong>Add note</strong>. Tick <strong>Mark as a key point</strong> for the important ones.</p>',
          image: 'meetings-notes.webp',
          alt: 'The Live notes section: the note kinds, the writing box with Add note, and four notes — a discussion, a decision marked as a key point, an action item and an issue.',
        },
        {
          title: 'Turn actions into tasks',
          body: '<p>On an Action Item note, <strong>Make it a task</strong> opens <strong>Create task from note</strong>: pick the project, due date and assignee, then click <strong>Create task</strong>. The task is listed under <strong>Action items</strong>, linked to the meeting. Each person sees theirs in <strong>My Action Items</strong>.</p>',
          image: 'meetings-actions.webp',
          alt: 'The Action items section: three items, each with an owner, due date, priority and status, and the box to add another.',
        },
        {
          title: 'End the meeting',
          body: '<p>Click <strong>End meeting</strong> when you finish. A meeting whose end time has passed is completed by itself.</p>',
        },
        {
          title: 'Write the final minutes',
          body: '<p>Under <strong>Final MOM</strong>, click <strong>Start from the notes</strong>, or <strong>Draft with AI</strong> (the bell tells you when the draft is ready). Check the summary, discussion, decisions, risks and next steps, click <strong>Save draft</strong>, then <strong>Mark as final</strong>.</p>',
          image: 'meetings-final-mom.webp',
          alt: 'The Final MOM section with the steps Notes, Final MOM, Approved and Emailed, and the Summary, Discussion, Decisions, Risks & open issues and Next steps boxes above the Mark as final button.',
        },
        {
          title: 'Email the minutes',
          body: '<p>Click <strong>Email minutes…</strong>. The meeting’s people are under <strong>To</strong>; add others to To or <strong>Cc</strong>, check the preview and click <strong>Send to … people</strong>. Everyone gets the minutes as one PDF, and <strong>Sent</strong> shows who got them.</p>',
          image: 'meetings-email.webp',
          alt: 'The Email the minutes window: four people ticked under To, boxes to add more people or Cc, and the subject and PDF attachment shown before the Send to 4 people button.',
        },
        {
          title: 'Follow up',
          body: '<p>A task made in the meeting shows <strong>From meeting</strong> in its details. When the task is done, its action item closes too.</p>',
        },
      ],
    },
    quiz('Quiz: Meetings & minutes', [
      single(
        'When are the meeting invitations sent?',
        [
          right('When you click Send invitations on the meeting’s page and send them', 'Yes — nothing is sent before that.'),
          wrong('As soon as you click Schedule meeting', 'Scheduling saves the meeting; the invitations wait for Send invitations.'),
          wrong('The day before the meeting', 'They are sent when you click Send invitations.'),
          wrong('Never — people have to check the calendar', 'You send them from the meeting’s page.'),
        ],
        'Invitations go out only when you send them from the meeting’s page.',
      ),
      multiple(
        'Which kinds of live notes can you add?',
        [
          right('Decision'),
          right('Action Item'),
          right('Issue'),
          wrong('Invoice', 'There is no Invoice note. The kinds are Discussion, Decision, Action Item, Issue, Question and Information.'),
        ],
        'Live notes can be a Discussion, Decision, Action Item, Issue, Question or Information.',
      ),
      order(
        'Put the steps of a meeting in order.',
        ['Schedule the meeting', 'Send the invitations', 'Take live notes', 'Mark the minutes as final', 'Email the minutes'],
        'Plan and invite first, take notes during the meeting, then finish and send the minutes.',
      ),
      trueFalse('The minutes go out as one email with the minutes attached as a PDF.', true, 'Everyone on the To and Cc lists gets the same email, with the PDF attached.'),
      single(
        'What does “Make it a task” do on an Action Item note?',
        [
          right('It makes a task, listed under Action items and linked to the meeting', 'Yes — the task stays linked to the meeting.'),
          wrong('It deletes the note', 'The note stays.'),
          wrong('It emails the note to everyone', 'Emails go out with the minutes, not from a note.'),
          wrong('It marks the note as a key point', 'That is the Mark as a key point box.'),
        ],
        'Make it a task turns the action into a real task, linked to the meeting.',
      ),
    ]),
  ],
};

// ── 4. Calendar ──────────────────────────────────────────────────────────────────────────────────

const calendar: StarterCourse = {
  key: 'starter:calendar',
  title: 'Calendar basics',
  summary: 'See tasks and meetings by date, move a task to another day, and add a task on the day it is due.',
  moduleKey: 'calendar',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  lessons: [
    video('Video: Calendar', 2),
    {
      kind: 'GUIDE',
      title: 'Use the calendar',
      minutes: 5,
      steps: [
        {
          title: 'Open the calendar',
          body: '<p>Click <strong>Calendar</strong> in the side menu. Tasks show on their due date and meetings at their start time. Switch between <strong>Month</strong>, <strong>Week</strong>, <strong>Day</strong> and <strong>Agenda</strong> at the top; <strong>Today</strong> takes you back to today.</p>',
          image: 'calendar-month.webp',
          alt: 'The Calendar in Month view: tasks and meetings on their days, with the Month, Week, Day and Agenda buttons and the filters at the top.',
        },
        {
          title: 'Look at a task',
          body: '<p>Click a task to see its status, due date, project and people. Click <strong>Open task</strong> for all its details, or <strong>Change dates</strong> to give it new dates. Click a meeting to open its page.</p>',
          image: 'calendar-preview.webp',
          alt: 'A task’s summary over the calendar: its status, due date, project, assignee and priority, with the Change dates and Open task buttons.',
        },
        {
          title: 'Move a task to another day',
          body: '<p>Drag a task to another day to change its due date. A message lets you <strong>Undo</strong> it. Finished tasks can’t be moved.</p>',
        },
        {
          title: 'Add a task on a day',
          body: '<p>Click a day’s number to see everything on that day, then click <strong>+ Task</strong> at the top. The new task gets that day as its due date.</p>',
          image: 'calendar-day.webp',
          alt: 'One day’s window: a meeting with Accept, Maybe and Decline, a task due that day, and the + Task and Plan time buttons at the top.',
        },
        {
          title: 'Choose what you see',
          body: '<p>Use <strong>All projects</strong>, <strong>Everyone</strong> and <strong>My tasks</strong> to narrow the calendar. <strong>More filters</strong> picks statuses and priorities and shows or hides completed tasks and meetings. <strong>Legend</strong> explains the colours.</p>',
          image: 'calendar-filters.webp',
          alt: 'The More filters panel with Status and Priority boxes, and Include options such as Show completed tasks and Show meetings.',
        },
        {
          title: 'Your week and time zone',
          body: '<p>To choose the day your week starts on, or your time zone, open <strong>Settings</strong> and go to <strong>Calendar &amp; dates</strong>.</p>',
        },
      ],
    },
    quiz('Quiz: Calendar', [
      single(
        'On which day does a task show on the calendar?',
        [
          right('On its due date', 'Yes — tasks sit on the day they are due.'),
          wrong('On the day it was created', 'It shows on its due date.'),
          wrong('On the first day of the month', 'It shows on its due date.'),
          wrong('Only on today', 'Every task with a due date shows on that day.'),
        ],
        'Tasks show on their due date; meetings show at their start time.',
      ),
      trueFalse('Dragging a task to another day changes its due date.', true, 'And a message lets you Undo the move.'),
      multiple(
        'Which views does the calendar have?',
        [right('Month'), right('Week'), right('Agenda'), wrong('Year', 'There is no Year view. The views are Month, Week, Day and Agenda.')],
        'You can switch between Month, Week, Day and Agenda.',
      ),
      single(
        'How do you add a task due on a particular day?',
        [
          right('Click the day’s number, then + Task', 'Yes — that day becomes its due date.'),
          wrong('Drag an empty box onto the day', 'Click the day’s number first.'),
          wrong('Open Settings → Calendar & dates', 'That is for your week start and time zone.'),
          wrong('Ask an administrator', 'Anyone can add a task on a day.'),
        ],
        'The day you clicked becomes the task’s due date.',
      ),
      single(
        'Where do you choose the day your week starts on?',
        [
          right('Settings → Calendar & dates', 'Yes — it is a setting of your own.'),
          wrong('The Kanban Board', 'The board doesn’t change your week.'),
          wrong('Chat', 'Chat has no calendar settings.'),
          wrong('My Tasks', 'Look in Settings → Calendar & dates.'),
        ],
        'Your week start and time zone are in Settings → Calendar & dates.',
      ),
    ]),
  ],
};

// ── 5. Projects ──────────────────────────────────────────────────────────────────────────────────

const projects: StarterCourse = {
  key: 'starter:projects',
  title: 'Projects basics',
  summary: 'Find your projects, see how each one is doing, look after its team, and start a new project.',
  moduleKey: 'projects',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  lessons: [
    video('Video: Projects', 2),
    {
      kind: 'GUIDE',
      title: 'Find your projects',
      minutes: 4,
      steps: [
        {
          title: 'Open Projects',
          body: '<p>Click <strong>Projects</strong> in the side menu to see the projects you are part of. The tabs at the top show them by status: <strong>Active</strong>, <strong>Planning</strong>, <strong>On hold</strong>, <strong>Completed</strong> and <strong>Archived</strong>.</p>',
          image: 'projects-list.webp',
          alt: 'The Projects page with status tabs, a search box and four project cards showing progress, open and overdue tasks, the next due date and the manager.',
        },
        {
          title: 'Read a project card',
          body: '<p>Each card shows the progress, how many tasks are open and overdue, the next due date, the team and the target date. The word Green, Amber or Red is the project’s health — click it to see why.</p>',
        },
        {
          title: 'Open a project',
          body: '<p>Click a project’s name. Its page has the tabs <strong>Overview</strong>, <strong>Board</strong>, <strong>Tasks</strong>, <strong>Meetings</strong>, <strong>Inspections</strong>, <strong>KPIs</strong> and <strong>Team</strong>.</p>',
          image: 'projects-overview.webp',
          alt: 'A project’s page: the totals at the top, the tabs Overview, Board, Tasks, Meetings, Inspections, KPIs and Team, and the project details below.',
        },
        {
          title: 'See the team',
          body: '<p>The <strong>Team</strong> tab shows who works on the project. The project’s owner, its managers and administrators can add people with <strong>Add a member</strong> and make someone a manager with <strong>Make manager</strong>.</p>',
          image: 'projects-team.webp',
          alt: 'The Team tab: five team members, each with Performance and Make manager links, and the Add a member box below.',
        },
      ],
    },
    {
      kind: 'GUIDE',
      title: 'Start a new project',
      minutes: 4,
      steps: [
        {
          title: 'Click New project',
          body: '<p>On the Projects page, click <strong>+ New project</strong>. Anyone can start a project.</p>',
          image: 'projects-new.webp',
          alt: 'The New project window: Name and Code on the left, Status, Priority, Owner, Team and the task settings on the right, and the Create project button.',
        },
        {
          title: 'Name it',
          body: '<p>Type the <strong>Name</strong>. A short <strong>Code</strong> is suggested from the name. Task numbers use it (for example HOM-12), so it can’t be changed later.</p>',
        },
        {
          title: 'Choose the status, owner and team',
          body: '<p>Pick the <strong>Status</strong> and <strong>Priority</strong>, the <strong>Owner</strong> — new tasks go to the owner unless you pick someone else — and the people for the <strong>Team</strong>.</p>',
        },
        {
          title: 'Create it',
          body: '<p>Click <strong>Create project</strong>. If you aren’t an administrator, you join the team as a manager, so you can keep running it.</p>',
        },
      ],
    },
    quiz('Quiz: Projects', [
      multiple(
        'Which of these does a project card show?',
        [
          right('How many tasks are overdue'),
          right('The next due date'),
          right('The project’s health (Green, Amber or Red)'),
          wrong('Everyone’s chat messages', 'Chat isn’t shown on project cards.'),
        ],
        'A card shows progress, open and overdue tasks, the next due date, the health, the team and the target date.',
      ),
      trueFalse('Only administrators can start a new project.', false, 'Anyone can start a project with + New project.'),
      single(
        'Why can’t a project’s code be changed after it is created?',
        [
          right('Task numbers use it, such as HOM-12', 'Yes — changing it would break every task number.'),
          wrong('It is the client’s password', 'The code is just the short name used in task numbers.'),
          wrong('It is set by the server each night', 'You choose it when you create the project.'),
          wrong('It can be changed at any time', 'Task numbers use it, so it is fixed.'),
        ],
        'Task numbers are made from the code, so it stays the same.',
      ),
      single(
        'You aren’t an administrator and you create a project. What happens?',
        [
          right('You join its team as a manager', 'Yes — so you can keep running it.'),
          wrong('It waits for an administrator to approve it', 'It is created at once.'),
          wrong('It is hidden from you', 'You join its team as a manager.'),
          wrong('Nothing: only administrators can create projects', 'Anyone can start a project.'),
        ],
        'If you aren’t an administrator, you join the new project’s team as a manager.',
      ),
      single(
        'Where do you add someone to a project’s team?',
        [
          right('The project’s Team tab', 'Yes — use Add a member.'),
          wrong('Chat', 'Chat channels follow the team; you add people on the Team tab.'),
          wrong('My Tasks', 'Assigning a task doesn’t add someone to the team.'),
          wrong('Calendar', 'Use the project’s Team tab.'),
        ],
        'The owner, managers and administrators add people on the Team tab.',
      ),
    ]),
  ],
};

// ── 6. Reports (administrators) ──────────────────────────────────────────────────────────────────

const reports: StarterCourse = {
  key: 'starter:reports',
  title: 'Reports basics',
  summary: 'For administrators: read the task, project and workload reports, filter them, and export them to Excel, PDF or CSV.',
  moduleKey: 'reports',
  audience: 'STAFF',
  roleKeys: ['admins'],
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  lessons: [
    video('Video: Reports and KPIs', 2),
    {
      kind: 'GUIDE',
      title: 'Read and export reports',
      minutes: 5,
      body: '<p>Reports is for administrators.</p>',
      steps: [
        {
          title: 'Open Reports',
          body: '<p>Click <strong>Reports</strong> in the side menu. The tiles at the top show the total tasks, how many are completed and overdue, and the on-time rate. Below them are the tasks by status and the on-time delivery.</p>',
          image: 'reports-page.webp',
          alt: 'The Reports page: the Export choice with Excel, PDF and CSV buttons, the Filter bar, four tiles and the Tasks by status chart.',
        },
        {
          title: 'Filter by project or person',
          body: '<p>Under <strong>Filter</strong>, pick a project in <strong>All projects</strong> or a person in <strong>All team</strong>. The tiles, charts and exports follow the filter. <strong>Clear</strong> shows everything again.</p>',
        },
        {
          title: 'Pick a period',
          body: '<p>Under <strong>Trends &amp; burndown</strong>, click <strong>7d</strong>, <strong>30d</strong> or <strong>90d</strong>, or type your own dates, to see how work was completed over that time.</p>',
        },
        {
          title: 'Compare projects',
          body: '<p><strong>Project progress</strong> lists each project with its total, completed, pending and overdue tasks.</p>',
          image: 'reports-tables.webp',
          alt: 'The Project progress table: each project with its total, completed, pending and overdue tasks and its completion.',
        },
        {
          title: 'See each person’s workload',
          body: '<p><strong>Employee workload</strong> shows how many tasks each person has, how many they completed and how many are overdue.</p>',
          image: 'reports-workload.webp',
          alt: 'The Employee workload section: a bar for each person’s assigned tasks and a table of assigned, completed and overdue tasks.',
        },
        {
          title: 'Export',
          body: '<p>At the top, choose what to export under <strong>Export</strong> — the full report or one section — and click <strong>Excel</strong>, <strong>PDF</strong> or <strong>CSV</strong>. CSV works for one section at a time.</p>',
        },
      ],
    },
    quiz('Quiz: Reports', [
      trueFalse('Only administrators can open Reports.', true, 'Reports is in the side menu for administrators only.'),
      multiple(
        'Which formats can you export a report to?',
        [right('Excel'), right('PDF'), right('CSV'), wrong('PowerPoint', 'Reports export to Excel, PDF or CSV.')],
        'Use the Excel, PDF or CSV buttons at the top of the page.',
      ),
      single(
        'Where do you see how many tasks each person has?',
        [
          right('Employee workload', 'Yes — assigned, completed and overdue for each person.'),
          wrong('Project progress', 'That compares projects, not people.'),
          wrong('On-time delivery', 'That shows on-time and late tasks.'),
          wrong('Audit Logs', 'Audit Logs show who did what, not workload.'),
        ],
        'Employee workload lists every person’s tasks.',
      ),
      single(
        'What does the CSV export work for?',
        [
          right('One section at a time', 'Yes — pick a single section under Export first.'),
          wrong('Only the full report', 'For the full report use Excel or PDF.'),
          wrong('Only charts', 'CSV is for one section’s figures.'),
          wrong('Nothing — it is switched off', 'It works for one section at a time.'),
        ],
        'Choose one section under Export to use CSV.',
      ),
      single(
        'You want one project’s report in Excel. What do you do first?',
        [
          right('Pick the project under Filter', 'Yes — the export follows the filter.'),
          wrong('Click CSV', 'CSV is for one section; pick the project first.'),
          wrong('Open the project’s Team tab', 'Reports has its own filter.'),
          wrong('Ask the project manager', 'Pick the project under Filter, then click Excel.'),
        ],
        'The export follows the filter, so pick the project first.',
      ),
    ]),
  ],
};

// ── 7. Chat ──────────────────────────────────────────────────────────────────────────────────────

const chat: StarterCourse = {
  key: 'starter:chat',
  title: 'Chat basics',
  summary: 'Talk with your team in each project’s channel or one to one: send, reply, mention and share files.',
  moduleKey: 'chat',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  lessons: [
    video('Video: Chat', 2),
    {
      kind: 'GUIDE',
      title: 'Talk with your team',
      minutes: 5,
      steps: [
        {
          title: 'Open Chat',
          body: '<p>Click <strong>Chat</strong> in the side menu. A red number on it means you have unread messages. Every project has its own channel under <strong>Project channels</strong>; one-to-one talks are under <strong>Direct messages</strong>.</p>',
          image: 'chat-channel.webp',
          alt: 'Chat with a project channel open: messages from four colleagues, and the message box at the bottom.',
        },
        {
          title: 'Send a message',
          body: '<p>Click a channel or a person, type in the box at the bottom and press <strong>Enter</strong> to send. <strong>Shift+Enter</strong> starts a new line and <strong>@</strong> mentions someone. The paperclip attaches files (up to 10 MB each).</p>',
        },
        {
          title: 'Reply to a message',
          body: '<p>Point at a message and click the reply arrow. The message you are answering shows above the box. Type your reply and send it.</p>',
          image: 'chat-reply.webp',
          alt: 'A reply being written: “Replying to Zara Ahmed” above the message box, under the message it answers.',
        },
        {
          title: 'Start a direct message',
          body: '<p>Click <strong>+</strong> next to Chat and pick a teammate under <strong>Message a teammate…</strong>.</p>',
          image: 'chat-direct.webp',
          alt: 'The Message a teammate list open in Chat, showing colleagues’ names to pick from.',
        },
        {
          title: 'Edit, delete or mute',
          body: '<p>Under <strong>More actions</strong> (⋯) on your own message you can <strong>Edit</strong> or <strong>Delete</strong> it. The ⋯ next to a conversation lets you add it to favorites, mute its notifications or archive it.</p>',
        },
      ],
    },
    quiz('Quiz: Chat', [
      single(
        'How do you start a new line without sending the message?',
        [
          right('Press Shift+Enter', 'Yes — Enter on its own sends.'),
          wrong('Press Enter', 'Enter sends the message.'),
          wrong('Press Tab', 'Tab moves to the next button.'),
          wrong('Press Escape', 'Escape doesn’t add a line.'),
        ],
        'Enter sends; Shift+Enter starts a new line.',
      ),
      trueFalse('Every project has its own chat channel.', true, 'Project channels are listed under Project channels.'),
      multiple(
        'What can you do with a message you sent?',
        [right('Edit it'), right('Delete it'), right('Add a reaction'), wrong('Change who sent it', 'A message always shows who sent it.')],
        'Use More actions (⋯) to edit or delete your own message.',
      ),
      single(
        'How do you start a direct message?',
        [
          right('Click + next to Chat and pick a teammate', 'Yes — then type and press Enter.'),
          wrong('Write @ and their name in a project channel', 'That mentions them in the channel.'),
          wrong('Open their profile in Settings', 'Use + next to Chat.'),
          wrong('Ask an administrator to add you', 'Anyone can message a teammate.'),
        ],
        'Click + next to Chat, pick the person, then write and send.',
      ),
      single(
        'What does the red number on Chat in the side menu mean?',
        [
          right('You have unread messages', 'Yes — muted conversations aren’t counted.'),
          wrong('Your tasks are overdue', 'Overdue tasks show in My Tasks.'),
          wrong('Chat is switched off', 'It counts unread messages.'),
          wrong('The number of projects you have', 'It counts unread messages.'),
        ],
        'The badge counts your unread messages.',
      ),
    ]),
  ],
};

// ── 8. MICO AI ───────────────────────────────────────────────────────────────────────────────────

const micoAi: StarterCourse = {
  key: 'starter:mico-ai',
  title: 'MICO AI basics',
  summary: 'Ask MICO AI about your tasks, projects, meetings, reports and chat, check its sources, and confirm any changes it suggests.',
  moduleKey: 'mico-ai',
  audience: 'STAFF',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  lessons: [
    video('Video: MICO AI', 2),
    {
      kind: 'GUIDE',
      title: 'Ask MICO AI',
      minutes: 4,
      steps: [
        {
          title: 'Open MICO AI',
          body: '<p>Click <strong>MICO AI</strong> in the side menu. It answers from your tasks, projects, meetings, reports and team chat — only from what you are allowed to see. Your chats are private to you.</p>',
          image: 'mico-ai-page.webp',
          alt: 'The MICO AI page: “How can I help?” with the person’s name, four suggested questions, and the question box at the bottom.',
        },
        {
          title: 'Ask a question',
          body: '<p>Type your question in the box at the bottom and press <strong>Enter</strong>, or click one of the suggested questions.</p>',
          image: 'mico-ai-ask.webp',
          alt: 'A question typed in the MICO AI box: “Which of my tasks are due this week?”, with the send button.',
        },
        {
          title: 'Check the answer',
          body: '<p>Answers link to their sources, so you can open the records they come from. Check important figures before you share them. Under an answer you can download a <strong>PDF report</strong>, <strong>Copy</strong> it or <strong>Retry</strong>.</p>',
        },
        {
          title: 'Changes only when you confirm',
          body: '<p>MICO AI can suggest changes, such as new tasks or a meeting. Nothing changes until you click <strong>Confirm</strong>, and you can undo for 15 minutes.</p>',
        },
        {
          title: 'Find your chats again',
          body: '<p>Your earlier chats are listed on the left. Use <strong>Search chats</strong> to find one, or <strong>New chat</strong> to start again. If the page says MICO AI isn’t set up yet, ask an administrator to add the AI service in AI Management.</p>',
        },
      ],
    },
    quiz('Quiz: MICO AI', [
      trueFalse('MICO AI only answers from MICO360 data you are allowed to see.', true, 'It never shows you records you can’t open yourself.'),
      single(
        'MICO AI suggests three new tasks. When are they created?',
        [
          right('Only after you click Confirm', 'Yes — and you can undo for 15 minutes.'),
          wrong('Straight away', 'Nothing changes until you confirm.'),
          wrong('The next morning', 'They are created when you click Confirm.'),
          wrong('When an administrator approves them', 'You confirm them yourself.'),
        ],
        'Suggested changes wait for your Confirm.',
      ),
      multiple(
        'What can you do under an answer?',
        [right('Download a PDF report'), right('Copy it'), right('Retry'), wrong('Publish it on a public website', 'Answers stay inside MICO360; your chats are private.')],
        'Each answer has PDF report, Copy and Retry.',
      ),
      single(
        'Who can read your MICO AI chats?',
        [
          right('Only you', 'Yes — your chats are private to you.'),
          wrong('Everyone in your projects', 'Your chats are private.'),
          wrong('Your clients', 'Clients never see MICO AI chats.'),
          wrong('Anyone who searches for them', 'Only you can see them.'),
        ],
        'MICO AI chats are private to the person who asked.',
      ),
      single(
        'What do you do before you share an important figure from an answer?',
        [
          right('Open its source and check it', 'Yes — answers link to the records they come from.'),
          wrong('Ask the same question again', 'Check the source instead.'),
          wrong('Nothing: answers are always right', 'Check important figures first.'),
          wrong('Download the PDF report', 'The PDF has the same answer; check the source.'),
        ],
        'Answers link to their sources: check important figures before you share them.',
      ),
    ]),
  ],
};

// ── 9. Admin settings (administrators) ───────────────────────────────────────────────────────────

const admin: StarterCourse = {
  key: 'starter:admin',
  title: 'Admin settings basics',
  summary: 'For administrators: add and change accounts, switch someone off, and find the company-wide settings.',
  moduleKey: 'admin',
  audience: 'STAFF',
  roleKeys: ['admins'],
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  lessons: [
    video('Video: Admin setup', 3),
    {
      kind: 'GUIDE',
      title: 'Manage people',
      minutes: 5,
      body: '<p>Administrators see an <strong>Admin</strong> group at the bottom of the side menu.</p>',
      steps: [
        {
          title: 'Open User Management',
          body: '<p>Click <strong>User Management</strong> in the Admin group. You see every account with its role, status and last sign-in.</p>',
          image: 'admin-users.webp',
          alt: 'The User & Profile Management page: a list of accounts with their email, role, status and last sign-in, and buttons for each account.',
        },
        {
          title: 'Add a person',
          body: '<p>Click <strong>+ New user</strong>. Type the first and last name, a <strong>Username</strong> and an <strong>Email</strong>, and pick the <strong>Role</strong>: Employee, Administrator or Client.</p>',
          image: 'admin-new-user.webp',
          alt: 'The New user window: First name, Last name, Username and Email, the “How will they get in?” choice, and the Role.',
        },
        {
          title: 'Choose how they get in',
          body: '<p>Under <strong>How will they get in?</strong>, email them an invitation link (recommended) or give them a temporary password yourself. Either way they choose their own password at their first sign-in. Click <strong>Create user</strong>.</p>',
        },
        {
          title: 'Change an account',
          body: '<p>Click <strong>Edit</strong> on a person’s row. Under <strong>Roles &amp; permissions</strong> tick Administrator or Employee, and under <strong>Account status</strong> choose Active, Inactive or Suspended. Click <strong>Save changes</strong>.</p>',
          image: 'admin-edit-user.webp',
          alt: 'The Manage account window: the person’s profile on the left, and Account status and Roles & permissions on the right.',
        },
        {
          title: 'When someone leaves',
          body: '<p>Make the account <strong>Inactive</strong>. The person is signed out everywhere at once; their tasks, comments and history stay.</p>',
        },
      ],
    },
    {
      kind: 'GUIDE',
      title: 'Company settings',
      minutes: 4,
      steps: [
        {
          title: 'System Settings',
          body: '<p>Click <strong>System Settings</strong> for the company-wide settings: Notification &amp; Scheduling (working days, holidays, reminders), KPI targets, task carry-forward, the weekly management summary, accounts, the daily email, backups and the Learning Hub tour.</p>',
          image: 'admin-settings.webp',
          alt: 'The System Settings page with the Notification & Scheduling, KPI targets, Task carry-forward, Weekly management summary and Accounts cards.',
        },
        {
          title: 'Clients and companies',
          body: '<p><strong>Clients</strong> is where you make client accounts and choose which projects each client sees. <strong>Companies</strong> lists the companies on the site.</p>',
        },
        {
          title: 'AI Management',
          body: '<p>In <strong>AI Management</strong> you connect an AI provider and choose the default models. MICO AI and the AI buttons around the site use them.</p>',
        },
        {
          title: 'Check what happened',
          body: '<p><strong>Audit Logs</strong> shows who did what, and when. <strong>Error Log</strong> shows problems in people’s browsers and on the server, kept for 30 days.</p>',
        },
      ],
    },
    quiz('Quiz: Admin settings', [
      multiple(
        'Which roles can you give a new user?',
        [right('Employee'), right('Administrator'), right('Client'), wrong('Visitor', 'The roles are Employee, Administrator and Client.')],
        'Pick the Role in the New user window.',
      ),
      trueFalse('Making an account inactive deletes the person’s tasks.', false, 'Their tasks, comments and history stay; they just can’t sign in.'),
      single(
        'Where do you set working days, holidays and reminders?',
        [
          right('System Settings → Notification & Scheduling', 'Yes — for each company.'),
          wrong('User Management', 'User Management is for accounts.'),
          wrong('Reports', 'Reports only show figures.'),
          wrong('Chat', 'Look in System Settings → Notification & Scheduling.'),
        ],
        'Notification & Scheduling is opened from System Settings.',
      ),
      order(
        'Put the steps for adding a person in order.',
        ['Click + New user', 'Type the name, username and email', 'Choose how they get in', 'Click Create user'],
        'Fill in who they are, choose invitation link or temporary password, then create the account.',
      ),
      single(
        'Where can you see who did what, and when?',
        [
          right('Audit Logs', 'Yes — every security-relevant change.'),
          wrong('Error Log', 'Error Log shows problems, not people’s actions.'),
          wrong('Templates', 'Templates are ready-made tasks and projects.'),
          wrong('My Tasks', 'Look in Audit Logs.'),
        ],
        'Audit Logs list who did what, from where, and what changed.',
      ),
    ]),
  ],
};

// ── 10. Client portal (clients) ──────────────────────────────────────────────────────────────────
// 12 Nov: no sign-in lesson (a client who reads it is signed in already); the project pages come first.

const portal: StarterCourse = {
  key: 'starter:portal',
  title: 'Client portal basics',
  summary: 'Follow your projects, sign off finished work, and read the meeting minutes shared with you.',
  moduleKey: 'portal',
  audience: 'CLIENTS',
  difficulty: 'BEGINNER',
  status: 'PUBLISHED',
  completionRule: 'ALL_LESSONS',
  certificateOn: false,
  certificateMonths: null,
  lessons: [
    video('Video: Client portal', 2),
    {
      kind: 'GUIDE',
      title: 'Your project, tasks and minutes',
      was: ['Tasks, sign-off and minutes'],
      minutes: 5,
      body: '<p>What you can do depends on the access the project team gave you.</p>',
      steps: [
        {
          title: 'Your projects',
          body: '<p><strong>Your projects</strong> shows the projects the team has shared with you and how far along each one is. Click a project to open it.</p>',
          image: 'portal-home.webp',
          alt: 'The Client portal home page, Your projects, with one project card showing its progress.',
        },
        {
          title: 'Follow the progress',
          body: '<p><strong>Progress &amp; tasks</strong> shows how much is done, the timeline from start to target, the milestones and the tasks shared with you. <strong>Download task list (PDF)</strong> keeps a copy.</p>',
          image: 'portal-project.webp',
          alt: 'A project in the Client portal: the Progress & tasks and Meetings & minutes tabs, the progress, the timeline and the milestones.',
        },
        {
          title: 'Open a task',
          body: '<p>In the task list, click a task to see its due date, status and description. <strong>Waiting for your sign-off</strong> means the team has finished it and needs your answer.</p>',
          image: 'portal-tasks.webp',
          alt: 'The Tasks list in the Client portal, with one finished task marked Waiting for your sign-off.',
        },
        {
          title: 'Sign it off',
          body: '<p>Under <strong>Sign off</strong>, click <strong>Accept</strong> if the work is done the way you need it, or <strong>Send back</strong> and say why.</p>',
          image: 'portal-task.webp',
          alt: 'A finished task in the Client portal with the Sign off box and its Accept and Send back buttons.',
        },
        {
          title: 'Ask a question or share a file',
          body: '<p>Under <strong>Comments</strong>, write a question or a note for the project team and click <strong>Send comment</strong>. Under <strong>Files</strong> you can download documents, and upload one when your access allows it.</p>',
        },
        {
          title: 'Read the minutes',
          body: '<p>Open <strong>Meetings &amp; minutes</strong> to see the project’s meetings. Open a meeting to see its details, answer its invitation if you were invited, and download the minutes as a PDF once they are shared with you.</p>',
          image: 'portal-meetings.webp',
          alt: 'The Meetings & minutes tab with a held meeting that has minutes.',
        },
        {
          title: 'Notices and your password',
          body: '<p>The bell at the top shows your notices. <strong>Notification settings</strong>, at the bottom of the page, chooses what you are told about. <strong>Change password</strong> is at the top.</p>',
        },
      ],
    },
    quiz('Quiz: Client portal', [
      single(
        'A task says “Waiting for your sign-off”. What does it mean?',
        [
          right('The team has finished it and needs your answer', 'Yes — Accept it or Send it back.'),
          wrong('It hasn’t started yet', 'It is finished and waiting for you.'),
          wrong('It was deleted', 'It is finished and waiting for you.'),
          wrong('You must pay for it', 'Sign-off is about the work, not payment.'),
        ],
        'Sign-off asks whether the finished work is what you need.',
      ),
      trueFalse('If you send a task back, you must say why.', true, 'The team needs your reason to put it right.'),
      multiple(
        'What can you find on a project’s page in the Client portal?',
        [right('Its progress'), right('The tasks shared with you'), right('Meetings & minutes'), wrong('The team’s private chat', 'The team’s chat is never shown in the Client portal.')],
        'You see the progress, timeline, milestones, the shared tasks and the shared minutes.',
      ),
      single(
        'Where do you see how much of your project is done?',
        [
          right('Progress & tasks, on the project’s page', 'Yes — with the timeline and milestones.'),
          wrong('Change password', 'That only changes your password.'),
          wrong('Notification settings', 'That chooses what you are told about.'),
          wrong('The bell', 'The bell shows your notices.'),
        ],
        'Open your project: Progress & tasks shows how much is done.',
      ),
      single(
        'Where do you choose what you are told about?',
        [
          right('Notification settings, at the bottom of the page', 'Yes.'),
          wrong('Change password', 'That only changes your password.'),
          wrong('Download task list (PDF)', 'That downloads the task list.'),
          wrong('Sign off', 'Sign off is for finished tasks.'),
        ],
        'Notification settings is linked at the bottom of every portal page.',
      ),
    ]),
  ],
};

/** The starter courses, in catalogue order (Getting started first: its position is -1). */
export const STARTER_COURSES: StarterCourse[] = [gettingStarted, tasks, board, meetings, calendar, projects, reports, chat, micoAi, admin, portal];
