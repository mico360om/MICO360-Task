import { PrismaClient, Priority, ProjectStatus, ColumnCategory, UserStatus } from '@prisma/client';
import { hashPassword } from '../src/lib/password';

const prisma = new PrismaClient();

const DEV_PASSWORD = 'Password1!';
const day = 86_400_000;
const daysFromNow = (n: number) => new Date(Date.now() + n * day);
const pick = <T>(arr: T[], i: number): T => arr[i % arr.length]!;

const COLUMNS: { name: string; category: ColumnCategory; color: string }[] = [
  { name: 'Backlog', category: 'BACKLOG', color: '#948985' },
  { name: 'To Do', category: 'TODO', color: '#3A6EA5' },
  { name: 'In Progress', category: 'IN_PROGRESS', color: '#B87611' },
  { name: 'Waiting / Blocked', category: 'BLOCKED', color: '#CB4632' },
  { name: 'Review', category: 'REVIEW', color: '#7A5AA8' },
  { name: 'Completed', category: 'DONE', color: '#2E7D53' },
];

async function main() {
  console.log('Seeding MICO360 Tasks…');

  // Clean (FK-safe order)
  await prisma.$transaction([
    prisma.activity.deleteMany(),
    prisma.taskAssignee.deleteMany(),
    prisma.taskWatcher.deleteMany(),
    prisma.checklistItem.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.attachment.deleteMany(),
    prisma.taskDependency.deleteMany(),
    prisma.taskTag.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.loginOtp.deleteMany(),
  ]);
  await prisma.task.deleteMany();
  await prisma.kanbanColumn.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
  await prisma.role.deleteMany();

  // Roles
  const adminRole = await prisma.role.create({ data: { name: 'ADMIN', description: 'Full system access' } });
  const employeeRole = await prisma.role.create({ data: { name: 'EMPLOYEE', description: 'Assigned work only' } });

  // Departments
  const deptNames = ['Engineering', 'Operations', 'Finance', 'Sales', 'Support'];
  const departments = await Promise.all(deptNames.map((name) => prisma.department.create({ data: { name } })));

  const passwordHash = await hashPassword(DEV_PASSWORD);

  // Admin
  const admin = await prisma.user.create({
    data: {
      email: 'admin@mico360.test',
      username: 'admin',
      passwordHash,
      firstName: 'Aisha',
      lastName: 'Khan',
      status: UserStatus.ACTIVE,
      departmentId: departments[0]!.id,
      roles: { create: { roleId: adminRole.id } },
    },
  });

  // 10 employees
  const firstNames = ['Omar', 'Sara', 'Bilal', 'Zara', 'Hassan', 'Nadia', 'Yusuf', 'Mariam', 'Imran', 'Layla'];
  const employees = [];
  for (let i = 0; i < firstNames.length; i++) {
    const fn = firstNames[i]!;
    const emp = await prisma.user.create({
      data: {
        email: `${fn.toLowerCase()}@mico360.test`,
        username: fn.toLowerCase(),
        passwordHash,
        firstName: fn,
        lastName: 'Ahmed',
        status: i === 9 ? UserStatus.INACTIVE : UserStatus.ACTIVE,
        departmentId: pick(departments, i).id,
        roles: { create: { roleId: employeeRole.id } },
      },
    });
    employees.push(emp);
  }

  // Tags
  const tagNames = ['bug', 'feature', 'urgent', 'client', 'internal', 'docs'];
  await Promise.all(tagNames.map((name, i) => prisma.tag.create({ data: { name, color: pick(['#CB4632', '#2E7D53', '#B87611', '#3A6EA5', '#948985', '#7A5AA8'], i) } })));

  // Projects
  const projectDefs = [
    { code: 'MICO', name: 'MICO360 Platform', client: 'Internal', status: ProjectStatus.ACTIVE, priority: Priority.HIGH },
    { code: 'RIG', name: 'Rig Inspection Portal', client: 'Gulf Energy', status: ProjectStatus.ACTIVE, priority: Priority.URGENT },
    { code: 'FIN', name: 'Finance Automation', client: 'Internal', status: ProjectStatus.PLANNING, priority: Priority.NORMAL },
    { code: 'SUP', name: 'Support Desk Revamp', client: 'Acme Corp', status: ProjectStatus.ON_HOLD, priority: Priority.LOW },
    { code: 'MOB', name: 'Mobile App (Phase 2)', client: 'Internal', status: ProjectStatus.PLANNING, priority: Priority.HIGH },
  ];

  let taskCounter = 0;
  for (let p = 0; p < projectDefs.length; p++) {
    const def = projectDefs[p]!;
    const manager = pick(employees, p);
    const project = await prisma.project.create({
      data: {
        code: def.code,
        name: def.name,
        description: `${def.name} — managed via MICO360 Tasks.`,
        clientName: def.client,
        managerId: manager.id,
        status: def.status,
        priority: def.priority,
        createdById: admin.id,
        startDate: daysFromNow(-30),
        targetDate: daysFromNow(60),
      },
    });

    // Members: admin + 4 employees
    const members = [admin, ...employees.slice(p, p + 4)];
    for (const m of members) {
      await prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: project.id, userId: m.id } },
        update: {},
        create: { projectId: project.id, userId: m.id },
      });
    }

    // Columns
    const columns = [];
    for (let c = 0; c < COLUMNS.length; c++) {
      const col = COLUMNS[c]!;
      columns.push(
        await prisma.kanbanColumn.create({
          data: { projectId: project.id, name: col.name, category: col.category, color: col.color, position: c },
        }),
      );
    }

    // ~11 tasks per project
    const priorities: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];
    for (let t = 0; t < 11; t++) {
      taskCounter++;
      const columnIndex = t % COLUMNS.length;
      const column = columns[columnIndex]!;
      const isDone = column.category === 'DONE';
      const dueOffset = [-3, -1, 0, 1, 3, 7, 14][t % 7]!; // mix of overdue/today/upcoming
      const task = await prisma.task.create({
        data: {
          key: `${def.code}-${t + 1}`,
          title: `${def.name}: work item ${t + 1}`,
          description: `Auto-seeded task ${t + 1} for ${def.name}.`,
          projectId: project.id,
          columnId: column.id,
          position: t,
          priority: pick(priorities, t + p),
          startDate: daysFromNow(-5),
          dueDate: isDone ? daysFromNow(-2) : daysFromNow(dueOffset),
          progress: isDone ? 100 : Math.min(90, columnIndex * 18),
          createdById: admin.id,
          completedAt: isDone ? daysFromNow(-1) : null,
        },
      });

      // Assignees: 1–3 members
      const assignees = [pick(employees, t + p), pick(employees, t + p + 1)];
      if (t % 3 === 0) assignees.push(pick(employees, t + p + 2));
      const uniqueAssignees = [...new Map(assignees.map((a) => [a.id, a])).values()];
      for (const a of uniqueAssignees) {
        await prisma.taskAssignee.create({ data: { taskId: task.id, userId: a.id } });
      }

      // Checklist on every 2nd task
      if (t % 2 === 0) {
        await prisma.checklistItem.createMany({
          data: [
            { taskId: task.id, text: 'Gather requirements', done: true, position: 0 },
            { taskId: task.id, text: 'Implement', done: isDone, position: 1 },
            { taskId: task.id, text: 'Review & sign-off', done: isDone, position: 2 },
          ],
        });
      }

      // Comment on every 3rd task
      if (t % 3 === 1) {
        await prisma.comment.create({
          data: { taskId: task.id, userId: pick(employees, t).id, body: 'Started on this — will update by EOD.' },
        });
      }
    }
  }

  console.log(`Seeded: 1 admin, ${employees.length} employees, ${projectDefs.length} projects, ${taskCounter} tasks.`);
  console.log(`Login with admin@mico360.test / ${DEV_PASSWORD} (or any employee username, e.g. "omar").`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
