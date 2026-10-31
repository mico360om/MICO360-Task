import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, RefreshControl, StyleSheet, Text, View, type ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../core/theme';
import { useServices } from '../core/providers';
import { refreshInspectionQueries, useInspectionDraft } from '../core/inspection-sync';
import { useInspection } from '../core/inspection-queries';
import { useProjectMembers, useProjects } from '../core/queries';
import { usePullRefresh } from '../components/meeting/live';
import { KeyboardAwareScrollView } from '../components/KeyboardAware';
import { Badge, Button, Card, IconButton, SectionTitle, SkeletonList } from '../components/ui';
import { InspectionItemRow, type ItemAnswer } from '../components/inspections/InspectionItemRow';
import { ProgressCard } from '../components/inspections/ProgressCard';
import { SyncBanner } from '../components/inspections/SyncBanner';
import { FinishCard } from '../components/inspections/FinishCard';
import { SignFinishSheet } from '../components/inspections/SignFinishSheet';
import { EarlierRevisionsCard, SignaturesCard } from '../components/inspections/SignaturesCard';
import { FailedItemsCard, askFollowUps } from '../components/inspections/FailedItemsCard';
import { InspectionActions, confirmDiscard } from '../components/inspections/InspectionActions';
import { InspectionClientSwitch } from '../components/inspections/InspectionClientSwitch';
import { ApiError, isNetworkError } from '../lib/api-client';
import { approvalNotice } from '../lib/approvals';
import { instantDayText } from '../lib/day-words';
import { appTimeZone } from '../lib/due-date';
import { detailView, type DraftView, type FlushState, type InspectionOutbox } from '../lib/inspection-outbox';
import type { SyncState } from '../lib/inspection-outboxes';
import type { InspectionDetail, SignatureInput } from '../lib/inspection-types';
import { INSPECTION_WORDS, finishedNotice, followUpNotice, inspectionChangeNote, problemText, startedLine } from '../lib/inspection-words';
import { failedWithout, type AssigneeChoice } from '../lib/inspection-follow-ups';
import { itemsOf } from '../lib/inspection-rules';
import { radius, spacing } from '../lib/theme';
import { toneStyle, type Tone } from '../lib/tone';
import { typeStyle } from '../lib/typography';
import type { AppScreenProps } from '../navigation/types';

type Nav = AppScreenProps<'Inspection'>['navigation'];

/**
 * One inspection, carried out on the phone — the website's inspection page. Every answer is saved
 * on this phone first and sent from there (the inspection outbox), so an inspection opened (or
 * started) here keeps working with no signal, even if the app closes; the banner says where the
 * changes are. With no signal and no copy on the phone it says so: it opens once there's a signal.
 */
export function InspectionScreen({ route, navigation }: AppScreenProps<'Inspection'>) {
  const c = useColors();
  const { inspectionId } = route.params;
  const { ownerId, ready, view, sync, online, send, sendSoon, outbox } = useInspectionDraft(inspectionId);
  const q = useInspection(inspectionId);
  const pull = usePullRefresh(q.refetch);
  const [changeNote, setChangeNote] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // The server's copy is kept on this phone (so it opens with no signal), under any changes waiting
  // here; a change someone else made since (taken over, reopened) is said once.
  const viewRef = useRef(view);
  viewRef.current = view;
  const lastRead = useRef<InspectionDetail | null>(null);
  useEffect(() => {
    if (!q.data || !ownerId || !outbox) return;
    const note = inspectionChangeNote(viewRef.current?.snapshot ?? lastRead.current, q.data, ownerId);
    if (note) setChangeNote(note);
    lastRead.current = q.data;
    outbox.remember(ownerId, q.data);
  }, [q.data, ownerId, outbox]);

  const shown: DraftView | null = view ?? (q.data ? detailView(q.data) : null);
  const title = shown?.snapshot.title;
  useEffect(() => {
    if (title) navigation.setOptions({ title });
  }, [navigation, title]);

  // Until the phone's records are read, "no copy here" can't be told from "not read yet".
  if (!ready) return <SkeletonList rows={4} />;

  if (!shown) {
    if (q.isError) {
      const offline = isNetworkError(q.error);
      const missing = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403);
      const words = offline
        ? { title: INSPECTION_WORDS.noSignalTitle, message: INSPECTION_WORDS.noSignal }
        : missing
          ? { title: INSPECTION_WORDS.notFoundTitle, message: INSPECTION_WORDS.notFound }
          : { title: INSPECTION_WORDS.loadFailedTitle, message: INSPECTION_WORDS.loadFailed };
      return (
        <SafeAreaView edges={['bottom']} style={[s.fill, { backgroundColor: c.ground }]}>
          <View style={s.page}>
            <Card>
              <Text style={[typeStyle('heading'), { color: c.ink }]} accessibilityRole="header">
                {words.title}
              </Text>
              <Text style={[typeStyle('body'), s.gapTop, { color: c.ink2 }]}>{words.message}</Text>
              <View style={s.buttons}>
                {!missing ? <Button title={INSPECTION_WORDS.tryAgain} onPress={() => void q.refetch()} loading={q.isFetching} /> : null}
                <Button title={INSPECTION_WORDS.backToProjects} variant="secondary" onPress={() => navigation.navigate('Tabs', { screen: 'Projects' })} />
              </View>
            </Card>
          </View>
        </SafeAreaView>
      );
    }
    return <SkeletonList rows={4} />;
  }

  return (
    <SafeAreaView edges={['bottom']} style={[s.fill, { backgroundColor: c.ground }]}>
      <KeyboardAwareScrollView
        ref={scrollRef}
        contentContainerStyle={s.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} colors={[c.brandText]} tintColor={c.brandText} />}
      >
        <InspectionContent
          view={shown}
          draft={view}
          inspectionId={inspectionId}
          ownerId={ownerId}
          outbox={outbox}
          sync={sync}
          online={online}
          send={send}
          sendSoon={sendSoon}
          showingCopy={!!view && !q.data && (q.isError || q.failureCount > 0)}
          refetch={() => void q.refetch()}
          changeNote={changeNote}
          onDismissChange={() => setChangeNote(null)}
          navigation={navigation}
          scrollRef={scrollRef}
        />
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

/** A note with a way to put it away: a change someone else made, a problem, or what just happened. */
function DismissNote({ text, tone, onDismiss }: { text: string; tone: Tone; onDismiss: () => void }) {
  const c = useColors();
  const t = toneStyle(c, tone);
  return (
    <View style={[s.note, { backgroundColor: t.bg, borderColor: t.border }]} accessibilityRole={tone === 'success' ? undefined : 'alert'} accessibilityLiveRegion="polite">
      <Text style={[typeStyle('body'), s.grow, { color: t.fg }]}>{text}</Text>
      <IconButton icon="ui.close" label={INSPECTION_WORDS.dismiss} onPress={onDismiss} color={t.fg} />
    </View>
  );
}

function InspectionContent({
  view,
  draft,
  inspectionId,
  ownerId,
  outbox,
  sync,
  online,
  send,
  sendSoon,
  showingCopy,
  refetch,
  changeNote,
  onDismissChange,
  navigation,
  scrollRef,
}: {
  /** What the screen shows: the record on this phone, or the inspection as read. */
  view: DraftView;
  /** The record on this phone (null: none kept, nothing waiting). */
  draft: DraftView | null;
  inspectionId: string;
  ownerId: string | null;
  outbox: InspectionOutbox | null;
  sync: SyncState;
  online: boolean;
  send: (opts?: { force?: boolean }) => Promise<FlushState>;
  sendSoon: () => void;
  showingCopy: boolean;
  refetch: () => void;
  changeNote: string | null;
  onDismissChange: () => void;
  navigation: Nav;
  scrollRef: React.RefObject<ScrollView>;
}) {
  const c = useColors();
  const { resources, queryClient: qc } = useServices();
  const timeZone = appTimeZone();
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [assignee, setAssignee] = useState<AssigneeChoice>('~default');
  const rows = useRef(new Map<string, View>());
  /** What a finish just said (a completed check), so the send's own notice doesn't hide it. */
  const completedNote = useRef<string | null>(null);
  const d = view.snapshot;
  const p = d.permissions;
  const finished = view.status === 'FINISHED';
  const canAnswer = p.canAnswer && !finished && !view.locked && view.problem?.stage !== 'answers';
  const answers = useMemo(() => new Map(view.answers.map((a) => [a.itemId, a])), [view.answers]);
  const followUps = useMemo(() => new Map((d.followUps ?? []).map((f) => [f.itemId, f])), [d.followUps]);
  const waitingFollowUps = useMemo(() => new Set(view.followUpsWaiting), [view.followUpsWaiting]);
  const record = !!outbox && !!ownerId;
  const membersQ = useProjectMembers(p.canMakeFollowUps ? d.projectId : '');
  const projectsQ = useProjects();
  const project = (projectsQ.data ?? []).find((x) => x.id === d.projectId);
  const archived = d.projectArchived ?? project?.status === 'ARCHIVED';
  const items = useMemo(() => itemsOf(d.structure), [d.structure]);
  const failedIds = items.filter((i) => answers.get(i.id)?.result === 'FAIL').map((i) => i.id);
  const canFollowUp = p.canMakeFollowUps && !archived;
  const followUpsFor = (itemIds: string[]) =>
    askFollowUps({ outbox, ownerId, inspectionId, itemIds, choice: assignee, detail: d, send: () => send(), onProblem: setProblem });
  let number = 0;

  const saveAnswer = (itemId: string, value: ItemAnswer) => {
    if (!outbox || !ownerId) return;
    try {
      outbox.saveAnswer(ownerId, inspectionId, { itemId, ...value });
      sendSoon();
    } catch (e) {
      setProblem(problemText(e, INSPECTION_WORDS.answerFailed));
    }
  };
  const openTask = (taskId: string, taskTitle?: string) => navigation.navigate('TaskDetail', { taskId, title: taskTitle });
  const refreshTask = useRef((taskId: string) => {
    void qc.invalidateQueries({ queryKey: ['task', taskId] });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['task-inspections'] });
  }).current;

  // A finish (now, or sent later from this phone) that completed its check, or made it wait for
  // approval, says so once.
  const completed = view.finishedCompleted;
  const waitingTask = view.finishedWaiting;
  useEffect(() => {
    const task = completed ?? waitingTask;
    if (!task || !outbox || !ownerId) return;
    completedNote.current = finishedNotice({ taskCompleted: completed, taskWaiting: completed ? null : waitingTask });
    setNotice(completedNote.current);
    outbox.ackFinished(ownerId, inspectionId);
    refreshTask(task.id);
  }, [completed, waitingTask, outbox, ownerId, inspectionId, refreshTask]);

  // A finish sent from here that went through offers to mark its task done (until answered).
  const offer = view.finishedOffer;
  const offered = useRef<string | null>(null);
  useEffect(() => {
    if (!offer || !outbox || !ownerId || offered.current === offer.id) return;
    offered.current = offer.id;
    const ack = () => outbox.ackFinished(ownerId, inspectionId);
    Alert.alert(INSPECTION_WORDS.markDoneTitle.replace('{key}', offer.key), INSPECTION_WORDS.markDoneBody.replace('{title}', offer.title), [
      { text: INSPECTION_WORDS.notNow, style: 'cancel', onPress: ack },
      {
        text: INSPECTION_WORDS.markDone,
        onPress: async () => {
          try {
            const moved = await resources.tasks.move(offer.id, offer.doneColumnId);
            ack();
            // A task that needs approval waits for a project manager instead of being done.
            setNotice(approvalNotice(offer.doneColumnId, moved) ?? INSPECTION_WORDS.markedDone);
            refreshTask(offer.id);
          } catch (e) {
            offered.current = null;
            setProblem(problemText(e, INSPECTION_WORDS.markDoneFailed));
          }
        },
      },
    ]);
  }, [offer, outbox, ownerId, inspectionId, resources, refreshTask]);

  const sign = async (signatures: SignatureInput[]) => {
    if (!outbox || !ownerId) return;
    outbox.queueFinish(ownerId, inspectionId, signatures);
    setSigning(false);
    const state = await send();
    if (state === 'sent') {
      const after = outbox.view(ownerId, inspectionId);
      setNotice(
        after?.finishedCompleted || after?.finishedWaiting
          ? finishedNotice({ taskCompleted: after.finishedCompleted, taskWaiting: after.finishedWaiting })
          : (completedNote.current ?? finishedNotice({ taskCompleted: null, taskWaiting: null })),
      );
    } else if (state === 'offline' || state === 'signed-out' || state === 'retry') setNotice(INSPECTION_WORDS.signedOffline);
  };

  // What became of follow-up tasks asked for here (now, or sent later from this phone): said once.
  const report = view.followUpReport;
  useEffect(() => {
    if (!report || !outbox || !ownerId) return;
    setNotice(followUpNotice(report, items));
    outbox.ackFollowUpReport(ownerId, inspectionId);
  }, [report, outbox, ownerId, inspectionId, items]);

  /** Scrolls to an item still to answer. */
  const jumpTo = (itemId: string) => {
    const row = rows.current.get(itemId);
    const list = scrollRef.current;
    const inner = list?.getInnerViewNode?.();
    if (!row || !list || !inner) return;
    row.measureLayout(
      inner,
      (_x, y) => list.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true }),
      () => undefined,
    );
  };
  const outcome = finished ? { label: d.result, tone: (view.counts.failed > 0 ? 'danger' : 'success') as Tone } : { label: INSPECTION_WORDS.inProgress, tone: 'info' as Tone };

  return (
    <View style={s.stack}>
      <Card>
        <Text style={[typeStyle('title'), { color: c.ink }]} accessibilityRole="header">
          {d.title}
        </Text>
        <View style={[s.badges, s.gapTop]}>
          <Badge label={outcome.label} tone={outcome.tone} />
          {view.locked ? <Badge label={INSPECTION_WORDS.signedLocked} tone="warning" /> : null}
        </View>
        <Text style={[typeStyle('body'), s.gapTop, { color: c.ink2 }]}>{[d.place, startedLine(d.startedAt, timeZone), INSPECTION_WORDS.inspector.replace('{name}', d.inspector.name)].filter(Boolean).join(' · ')}</Text>
        {d.task ? (
          <View style={s.taskLink}>
            <Button title={INSPECTION_WORDS.forTask.replace('{key}', d.task.key)} variant="ghost" size="sm" onPress={() => openTask(d.task!.id, d.task!.title)} accessibilityHint="Opens the task" />
          </View>
        ) : null}
        {d.reopened ? (
          <Text style={[typeStyle('caption'), s.gapTop, { color: c.ink2 }]}>
            {INSPECTION_WORDS.revision
              .replace('{n}', String((d.revision ?? 0) + 1))
              .replace('{day}', instantDayText(d.reopened.at, timeZone))
              .replace('{name}', d.reopened.by.name)}
          </Text>
        ) : null}
      </Card>
      <InspectionActions detail={d} finished={finished} ownerId={ownerId} outbox={outbox} onProblem={setProblem} />

      {record ? (
        <SyncBanner
          view={draft}
          sync={sync}
          online={online}
          onTryNow={() => {
            if (outbox && ownerId) outbox.clearProblem(ownerId, inspectionId);
            void send({ force: true });
          }}
          onDiscard={() => confirmDiscard({ outbox, ownerId, inspectionId, onDone: refetch })}
          onLookAgain={() => {
            if (outbox && ownerId) outbox.clearProblem(ownerId, inspectionId);
            refetch();
          }}
          onOk={() => outbox && ownerId && outbox.clearProblem(ownerId, inspectionId)}
        />
      ) : null}
      {showingCopy ? (
        <View style={[s.note, { backgroundColor: c.infoSoft, borderColor: c.info }]} accessibilityLiveRegion="polite">
          <Text style={[typeStyle('body'), s.grow, { color: c.infoText }]}>{INSPECTION_WORDS.showingCopy}</Text>
        </View>
      ) : null}
      {changeNote ? <DismissNote text={changeNote} tone="warning" onDismiss={onDismissChange} /> : null}
      {problem ? <DismissNote text={problem} tone="danger" onDismiss={() => setProblem(null)} /> : null}
      {notice ? <DismissNote text={notice} tone="success" onDismiss={() => setNotice(null)} /> : null}

      <ProgressCard counts={view.counts} description={d.description} />

      {failedIds.length && canFollowUp ? (
        <FailedItemsCard
          failedCount={failedIds.length}
          without={failedWithout(view, failedIds)}
          members={membersQ.data ?? []}
          owner={project?.ownerId ? { id: project.ownerId } : null}
          choice={assignee}
          onChoice={setAssignee}
          ownerId={ownerId}
          inspectionId={inspectionId}
          outbox={outbox}
          detail={d}
          send={() => send()}
          onProblem={setProblem}
        />
      ) : null}

      {d.structure.sections.map((section) => (
        <Card key={section.id}>
          <SectionTitle>{section.title}</SectionTitle>
          {section.items.map((item) => {
            number += 1;
            return (
              <View
                key={item.id}
                ref={(node) => {
                  if (node) rows.current.set(item.id, node);
                  else rows.current.delete(item.id);
                }}
                collapsable={false}
              >
              <InspectionItemRow
                item={item}
                number={number}
                answer={answers.get(item.id)}
                readOnly={!canAnswer}
                onAnswer={(v) => saveAnswer(item.id, v)}
                followUp={{ view: followUps.get(item.id), queued: waitingFollowUps.has(item.id) }}
                canMakeFollowUp={canFollowUp}
                onMakeFollowUp={() => followUpsFor([item.id])}
                onOpenTask={(taskId) => openTask(taskId)}
              />
              </View>
            );
          })}
        </Card>
      ))}

      {!finished && p.canFinish && record ? (
        <FinishCard view={view} canAnswer={canAnswer} onSign={() => setSigning(true)} onTakeBack={() => outbox && ownerId && outbox.cancelFinish(ownerId, inspectionId)} onJump={jumpTo} />
      ) : null}
      {finished ? (
        <SignaturesCard detail={d} timeZone={timeZone}>
          <InspectionClientSwitch detail={d} archived={!!archived} onChanged={() => refreshInspectionQueries(qc, inspectionId, d.projectId)} />
        </SignaturesCard>
      ) : null}
      <EarlierRevisionsCard detail={d} timeZone={timeZone} />

      {signing ? (
        <SignFinishSheet
          visible
          roles={d.signatureRoles}
          inspectorName={d.inspector.name}
          online={online && sync !== 'offline'}
          onCancel={() => setSigning(false)}
          onSign={(sigs) => void sign(sigs)}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  page: { padding: spacing.lg, paddingBottom: spacing.xxl },
  stack: { gap: spacing.md },
  gapTop: { marginTop: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  taskLink: { alignSelf: 'flex-start', marginTop: spacing.xs },
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.input, paddingLeft: spacing.md, paddingVertical: spacing.xs },
  grow: { flex: 1 },
});
