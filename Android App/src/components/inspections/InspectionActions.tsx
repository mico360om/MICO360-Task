import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useServices } from '../../core/providers';
import { refreshInspectionQueries } from '../../core/inspection-sync';
import { ACTION_WORDS, backToProject, inspectionMenu, type InspectionAction } from '../../lib/inspection-client';
import type { InspectionOutbox } from '../../lib/inspection-outbox';
import type { InspectionDetail } from '../../lib/inspection-types';
import { problemText } from '../../lib/inspection-words';
import { spacing } from '../../lib/theme';
import type { AppStackParamList } from '../../navigation/types';
import { Button } from '../ui';

/** A failed download's words: the exporter's own "Export failed (500)" is not a reason a person can use. */
const downloadProblem = (e: unknown) => (e instanceof Error && /^Export failed/.test(e.message) ? ACTION_WORDS.reportFailed : problemText(e, ACTION_WORDS.reportFailed));

/**
 * "Throw away what’s on this phone?" — the banner's way out of a refusal: the changes saved on this
 * phone for the inspection go (nothing on the server changes), then it is read again.
 */
export function confirmDiscard(o: { outbox: InspectionOutbox | null; ownerId: string | null; inspectionId: string; onDone: () => void }): void {
  Alert.alert(ACTION_WORDS.discardTitle, ACTION_WORDS.discardBody, [
    { text: ACTION_WORDS.keep, style: 'cancel' },
    {
      text: ACTION_WORDS.discard,
      style: 'destructive',
      onPress: () => {
        if (o.outbox && o.ownerId) o.outbox.discard(o.ownerId, o.inspectionId);
        o.onDone();
      },
    },
  ]);
}

/**
 * The inspection's actions, as the website's page header: the report PDF (finished), Take over,
 * Reopen and Delete — each only when the server allows it, each confirmed first. They need a
 * connection; what they return is kept on the phone.
 */
export function InspectionActions({
  detail,
  finished,
  unsent,
  ownerId,
  outbox,
  onProblem,
}: {
  detail: InspectionDetail;
  finished: boolean;
  /** This person has changes to it not sent yet: no Delete until they are (lib/inspection-client). */
  unsent: boolean;
  ownerId: string | null;
  outbox: InspectionOutbox | null;
  onProblem: (text: string | null) => void;
}) {
  const { resources, exporter, queryClient: qc } = useServices();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [busy, setBusy] = useState<InspectionAction | null>(null);
  const id = detail.id;
  const actions = inspectionMenu(detail.permissions, finished, unsent);
  if (!actions.length) return null;

  const download = async () => {
    setBusy('report');
    onProblem(null);
    try {
      await exporter.exportFile(resources.inspections.reportPdfPath(id), 'inspection-report.pdf', detail.title);
    } catch (e) {
      onProblem(downloadProblem(e));
    } finally {
      setBusy(null);
    }
  };

  const change = async (what: 'reopen' | 'takeOver') => {
    setBusy(what);
    onProblem(null);
    try {
      const result = what === 'reopen' ? await resources.inspections.reopen(id) : await resources.inspections.takeOver(id);
      if (outbox && ownerId) outbox.remember(ownerId, result);
      refreshInspectionQueries(qc, id, detail.projectId);
    } catch (e) {
      onProblem(problemText(e, ACTION_WORDS.failed));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    onProblem(null);
    try {
      await resources.inspections.remove(id);
      if (outbox && ownerId) outbox.discard(ownerId, id);
      refreshInspectionQueries(qc, id, detail.projectId);
      // Back to the project's screen it came from — never a second one on top of it.
      const state = navigation.getState();
      const back = backToProject(state.routes, state.index, detail.projectId);
      if ('pop' in back) navigation.pop(back.pop);
      else navigation.replace('ProjectDetail', { projectId: detail.projectId, tab: 'inspections' });
    } catch (e) {
      onProblem(problemText(e, ACTION_WORDS.failed));
      setBusy(null);
    }
  };

  const ask = (title: string, body: string, confirm: string, run: () => void, destructive = false) =>
    Alert.alert(title, body, [
      { text: ACTION_WORDS.keep, style: 'cancel' },
      { text: confirm, style: destructive ? 'destructive' : 'default', onPress: run },
    ]);

  return (
    <View style={s.row}>
      {actions.map((a) =>
        a === 'report' ? (
          <Button key={a} title={ACTION_WORDS.report} icon="ui.download" variant="secondary" size="sm" loading={busy === 'report'} disabled={!!busy} onPress={() => void download()} />
        ) : a === 'takeOver' ? (
          <Button
            key={a}
            title={ACTION_WORDS.takeOver}
            variant="secondary"
            size="sm"
            loading={busy === 'takeOver'}
            disabled={!!busy}
            onPress={() => ask(ACTION_WORDS.takeOverTitle, ACTION_WORDS.takeOverBody.replace('{inspector}', detail.inspector.name), ACTION_WORDS.takeOver, () => void change('takeOver'))}
          />
        ) : a === 'reopen' ? (
          <Button
            key={a}
            title={ACTION_WORDS.reopen}
            variant="secondary"
            size="sm"
            loading={busy === 'reopen'}
            disabled={!!busy}
            onPress={() => ask(ACTION_WORDS.reopenTitle, ACTION_WORDS.reopenBody, ACTION_WORDS.reopen, () => void change('reopen'))}
          />
        ) : (
          <Button
            key={a}
            title={ACTION_WORDS.delete}
            variant="danger"
            size="sm"
            loading={busy === 'delete'}
            disabled={!!busy}
            onPress={() => ask(ACTION_WORDS.deleteTitle, ACTION_WORDS.deleteBody, ACTION_WORDS.delete, () => void remove(), true)}
          />
        ),
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
