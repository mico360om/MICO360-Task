import { StyleSheet, View } from 'react-native';
import { EmptyState } from '../components/ui';
import { useServices } from '../core/providers';
import { openWebsitePage } from '../adapters/website';
import type { AppScreenProps } from '../navigation/types';

/**
 * MICO AI (Stage 3 Task 1): a shell that offers the website's page until Lane AI builds this
 * screen. Stage 3 Task 17 checks that no shell is left.
 */
export function MicoAiScreen(_props: AppScreenProps<'MicoAi'>) {
  const { baseUrl } = useServices();
  return (
    <View style={styles.page}>
      <EmptyState icon="nav.ai" title="MICO AI" action={{ title: 'Open on the website', onPress: () => openWebsitePage(baseUrl, '/mico-ai') }} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center' },
});
