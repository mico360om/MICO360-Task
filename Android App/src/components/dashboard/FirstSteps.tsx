import { StyleSheet, View } from 'react-native';
import { FIRST_STEPS_TEXT } from '../../lib/dashboard';
import { Button, Card, EmptyState } from '../ui';

/**
 * A company's (or a newcomer's) first day, where the charts and lists will be — the website's
 * FirstSteps: the flag at the start line, what to do first for the role, and the first steps as
 * buttons: "Create a project" (anyone may) and, for an administrator, "Add your team".
 */
export function FirstSteps({ isAdmin, onCreateProject, onAddTeam }: { isAdmin: boolean; onCreateProject: () => void; onAddTeam: () => void }) {
  const words = isAdmin ? FIRST_STEPS_TEXT.admin : FIRST_STEPS_TEXT.employee;
  return (
    <Card>
      <EmptyState icon="misc.flag" title={words.title} subtitle={words.body} />
      <View style={s.actions}>
        <Button title={FIRST_STEPS_TEXT.createProject} onPress={onCreateProject} />
        {isAdmin ? <Button title={FIRST_STEPS_TEXT.addTeam} variant="secondary" onPress={onAddTeam} /> : null}
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, paddingBottom: 16 },
});
