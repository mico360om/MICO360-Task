import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, AccessibilityInfo } from 'react-native';
import { useColors } from '../../core/theme';
import { useTeamChanges } from '../../core/project-queries';
import { Badge, Button, ErrorNote } from '../ui';
import { InlinePicker, SheetMessage } from '../meeting/sheet-kit';
import { EmptyNote, SectionCard } from './parts';
import { addableUsers, memberLabel, memberProblem, membersInOrder, removeQuestion, roleAction } from '../../lib/project-team';
import { displayName, type ApiDirectoryUser, type ApiMember } from '../../lib/types';
import { spacing, radius, fontSize, type Palette } from '../../lib/theme';

/**
 * The project's people (the Team tab), as on the website: everyone on it, managers first. An
 * administrator or one of the project's managers (the server's rule) can add people, make someone
 * a manager or a member, and take someone off — each saved at once (it needs a connection).
 */
export function TeamTab({
  projectId,
  members,
  loadFailed,
  onRetry,
  retrying,
  canManage,
  people,
  myId,
}: {
  projectId: string;
  members: ApiMember[];
  loadFailed: boolean;
  onRetry: () => void;
  retrying: boolean;
  canManage: boolean;
  people: ApiDirectoryUser[];
  myId: string | null | undefined;
}) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { add, setRole, remove } = useTeamChanges(projectId);
  const [toAdd, setToAdd] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ordered = useMemo(() => membersInOrder(members), [members]);
  const addable = useMemo(() => (canManage ? addableUsers(people, members) : []), [canManage, people, members]);

  function addOne() {
    if (!toAdd) return;
    const who = addable.find((a) => a.value === toAdd)?.label ?? 'They';
    setProblem(null);
    add.mutate(toAdd, {
      onSuccess: () => {
        setToAdd('');
        AccessibilityInfo.announceForAccessibility(`${who} was added to the project.`);
      },
      onError: (e) => setProblem(memberProblem(e, 'add')),
    });
  }

  function changeRole(m: ApiMember) {
    const next = roleAction(m);
    setProblem(null);
    setBusyId(m.id);
    setRole.mutate(
      { userId: m.id, role: next.role },
      {
        onSuccess: () => AccessibilityInfo.announceForAccessibility(`${displayName(m)} is now a ${next.role === 'MANAGER' ? 'manager' : 'member'}.`),
        onError: (e) => setProblem(memberProblem(e, 'role')),
        onSettled: () => setBusyId(null),
      },
    );
  }

  function askRemove(m: ApiMember) {
    const q = removeQuestion(m, myId);
    Alert.alert(q.title, q.message, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          setProblem(null);
          setBusyId(m.id);
          remove.mutate(m.id, {
            onSuccess: () => AccessibilityInfo.announceForAccessibility(`${displayName(m)} was removed from the project.`),
            onError: (e) => setProblem(memberProblem(e, 'remove')),
            onSettled: () => setBusyId(null),
          });
        },
      },
    ]);
  }

  return (
    <SectionCard title={`Team members · ${members.length}`}>
      {loadFailed && members.length === 0 ? <ErrorNote message="The team list isn’t available right now." onRetry={onRetry} retrying={retrying} /> : null}
      {!loadFailed && members.length === 0 ? <EmptyNote>No members yet.</EmptyNote> : null}
      <SheetMessage text={problem} />
      {ordered.map((m) => {
        const role = roleAction(m);
        const busy = busyId === m.id;
        return (
          <View key={m.id} style={s.member}>
            <View style={s.who} accessible accessibilityLabel={memberLabel(m, myId)}>
              <View style={s.avatar}>
                <Text style={s.avatarText} allowFontScaling={false}>
                  {displayName(m).slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={s.text}>
                <Text style={s.name}>
                  {displayName(m)}
                  {m.id === myId ? <Text style={s.you}> (you)</Text> : null}
                </Text>
                <Text style={s.sub}>@{m.username}</Text>
              </View>
              {m.role === 'MANAGER' ? <Badge label="Manager" tone="brand" /> : null}
            </View>
            {canManage ? (
              <View style={s.actions}>
                <Button title={role.label} accessibilityLabel={role.a11y} variant="secondary" onPress={() => changeRole(m)} loading={busy && setRole.isPending} disabled={busy} style={s.action} />
                <Button title="Remove" accessibilityLabel={`Remove ${displayName(m)}`} variant="ghost" onPress={() => askRemove(m)} loading={busy && remove.isPending} disabled={busy} style={s.action} />
              </View>
            ) : null}
          </View>
        );
      })}
      {canManage ? (
        addable.length > 0 ? (
          <View style={s.add}>
            <InlinePicker label="Add a member" options={addable} value={toAdd} onChange={setToAdd} placeholder="Select a teammate…" disabled={add.isPending} />
            <Button title="Add" accessibilityLabel="Add to the project" onPress={addOne} loading={add.isPending} disabled={!toAdd} />
          </View>
        ) : people.length ? (
          <Text style={s.sub}>Everyone is on this project already.</Text>
        ) : null
      ) : null}
    </SectionCard>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    member: { borderTopWidth: 1, borderTopColor: c.line, paddingVertical: spacing.sm, gap: spacing.sm },
    who: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    avatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: c.onBrand, fontWeight: '700', fontSize: 12 },
    text: { flex: 1 },
    name: { fontSize: fontSize.md, fontWeight: '600', color: c.ink },
    you: { fontWeight: '400', color: c.ink2 },
    sub: { fontSize: fontSize.sm, color: c.ink2 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    action: { flexGrow: 1, flexBasis: '40%', minHeight: 44 },
    add: { borderTopWidth: 1, borderTopColor: c.line, paddingTop: spacing.md, gap: spacing.sm },
  });
