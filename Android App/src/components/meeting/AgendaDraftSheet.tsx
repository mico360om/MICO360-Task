import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, StyleSheet } from 'react-native';
import { useColors } from '../../core/theme';
import { useAddDraftedAgenda, useDraftAgenda } from '../../core/meeting-ai';
import { AgendaDraftReview } from '../meeting-form/AgendaDraftReview';
import { ActionRowButton, Sheet, SheetButtons, SheetMessage } from './sheet-kit';
import { draftAddText, meetingAiFailure, pageAgendaRequest } from '../../lib/meeting-ai';
import { fontSize } from '../../lib/theme';
import type { AiAgendaItem, ApiMeeting, ApiMeetingAttendee } from '../../lib/types';

/**
 * "Draft agenda" on the meeting's page (2c), as on the website: the AI proposes items from the
 * meeting's details, its project's open tasks and the last meeting's leftovers, with a lead (the
 * organizer or an invited team member) and minutes. Nothing is added until "Add selected"; the
 * ticked items go after the existing ones. Needs a connection. Whoever runs the meeting.
 */
export function AgendaDraftSheet({
  meeting,
  attendees,
  nameOf,
  visible,
  onClose,
  onAdded,
}: {
  meeting: ApiMeeting;
  attendees: ApiMeetingAttendee[];
  nameOf: (userId: string) => string | null;
  visible: boolean;
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const c = useColors();
  const draft = useDraftAgenda();
  const add = useAddDraftedAgenda(meeting.id);
  const [items, setItems] = useState<AiAgendaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = () => {
    setError(null);
    setItems(null);
    draft.mutate(pageAgendaRequest(meeting, attendees), {
      onSuccess: setItems,
      onError: (e) => setError(meetingAiFailure(e, 'Couldn’t draft an agenda. Try again, or add the items yourself.')),
    });
  };
  // Opening the sheet asks for a draft; closing it forgets the draft.
  useEffect(() => {
    if (visible) ask();
    else {
      setItems(null);
      setError(null);
      draft.reset();
      add.reset();
    }
    // Only when the sheet opens or closes.
  }, [visible]);

  const addChosen = (chosen: AiAgendaItem[]) => {
    setError(null);
    add.mutate(chosen, {
      onSuccess: (r) => {
        if (!r.error) {
          onAdded(r.added.length);
          onClose();
          return;
        }
        // The ones added are on the agenda now: only the rest stay to try again.
        setItems(r.left);
        setError(draftAddText(r.added.length, chosen.length, r.error));
      },
    });
  };

  return (
    <Sheet visible={visible} title="Draft agenda" subtitle="Suggested from the meeting’s details, its project’s open tasks and what the last meeting left open. Nothing is added until you choose." onClose={add.isPending ? () => {} : onClose} footer={<SheetButtons cancel="Close" onCancel={onClose} busy={add.isPending} />}>
      {draft.isPending ? (
        <>
          <ActivityIndicator />
          <Text style={[styles.small, { color: c.ink2 }]}>Drafting… the AI can take a minute or two.</Text>
        </>
      ) : null}
      <SheetMessage text={error} />
      {!draft.isPending && !items && error ? <ActionRowButton label="Try again" onPress={ask} /> : null}
      {items ? <AgendaDraftReview items={items} leadName={(id) => (id ? nameOf(id) : null)} onAdd={addChosen} onDismiss={onClose} busy={add.isPending} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  small: { fontSize: fontSize.xs, textAlign: 'center' },
});
