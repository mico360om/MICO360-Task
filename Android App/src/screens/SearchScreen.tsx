import React, { useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, SectionList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useServices, useSession } from '../core/providers';
import { useColors } from '../core/theme';
import { useSearch } from '../core/search-queries';
import { useDebouncedValue } from '../core/useDebounced';
import { ApiError, isNetworkError } from '../lib/api-client';
import { SEARCH_DEBOUNCE_MS, exactTask, routeOf, searchEnabled, searchItems, searchStatus, type SearchItem } from '../lib/search';
import { openWebsitePage } from '../adapters/website';
import { spacing, radius, fontSize, type Palette } from '../lib/theme';
import type { AppScreenProps, AppStackParamList } from '../navigation/types';

const RESULT_GROUPS = new Set(['Tasks', 'Projects', 'People', 'Meetings']);

/**
 * Search (6b), as the website's search box: tasks, projects, people and meetings you may see, the
 * app's pages, and "open MICO-7". It asks the server once typing pauses, from 2 letters; a result
 * opens its screen (a person: your profile, User Management for an administrator, or a chat), and a
 * website-only page opens in the browser. Searching needs a connection; the pages open offline too.
 */
export function SearchScreen({ navigation }: AppScreenProps<'Search'>) {
  const c = useColors();
  const s = useMemo(() => makeStyles(c), [c]);
  const { resources, baseUrl } = useServices();
  const session = useSession();
  const isAdmin = (session?.user.roles ?? []).includes('ADMIN');
  const myId = session?.user.id ?? null;
  const [term, setTerm] = useState('');
  const debounced = useDebouncedValue(term, SEARCH_DEBOUNCE_MS);
  const searchQ = useSearch(debounced);
  const asked = searchEnabled(debounced);
  const results = asked ? searchQ.data : undefined;
  const items = useMemo(() => searchItems({ raw: term, results, isAdmin, myId }), [term, results, isAdmin, myId]);
  const resultCount = items.filter((i) => RESULT_GROUPS.has(i.group)).length;
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const status =
    message ??
    searchStatus({ term, debounced, loading: asked && searchQ.isFetching && !searchQ.data, error: asked && searchQ.isError && !searchQ.data ? searchQ.error : null, resultCount });

  const sections = useMemo(() => {
    const out: { title: string; data: SearchItem[] }[] = [];
    for (const it of items) {
      const last = out[out.length - 1];
      if (last && last.title === it.group) last.data.push(it);
      else out.push({ title: it.group, data: [it] });
    }
    return out;
  }, [items]);

  const go = (name: string, params: object | undefined) => (navigation.navigate as unknown as (n: string, p?: object) => void)(name, params);

  async function open(item: SearchItem) {
    if (busy) return;
    setMessage(null);
    const t = item.target;
    if (t.kind === 'screen') {
      const route = routeOf(t.action);
      if (route) go(route.name, route.params);
      return;
    }
    if (t.kind === 'website') {
      openWebsitePage(baseUrl, t.path);
      return;
    }
    setBusy(item.id);
    try {
      if (t.kind === 'openKey') {
        // Exactly that key: search finds WEB-50 for WEB-5 too.
        const task = exactTask(await resources.search(t.key), t.key);
        if (task) go('TaskDetail', { taskId: task.id, title: task.title });
        else setMessage(`No task ${t.key}.`);
      } else {
        const conversation = await resources.chat.startDirect(t.userId);
        const params: AppStackParamList['ChatThread'] = { conversationId: conversation.id, title: t.name };
        go('ChatThread', params);
      }
    } catch (e) {
      setMessage(
        isNetworkError(e)
          ? 'You’re offline — this needs a connection.'
          : e instanceof ApiError && e.status < 500 && e.code !== 'ERROR' && e.message
            ? e.message
            : t.kind === 'openKey'
              ? 'Couldn’t open the task. Please try again.'
              : 'Couldn’t open the chat. Please try again.',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <View style={s.box}>
        <TextInput
          ref={inputRef}
          value={term}
          onChangeText={(v) => {
            setTerm(v);
            setMessage(null);
          }}
          placeholder="Search or type a command…"
          placeholderTextColor={c.ink3}
          accessibilityLabel="Search"
          accessibilityHint="Finds tasks, projects, people, meetings and pages"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          maxLength={200}
          style={s.input}
        />
        {term ? (
          <Pressable
            onPress={() => {
              setTerm('');
              setMessage(null);
              inputRef.current?.focus();
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear the search"
            hitSlop={8}
            style={s.clear}
          >
            <Text style={s.clearText}>✕</Text>
          </Pressable>
        ) : null}
      </View>
      {status ? (
        <Text style={s.status} accessibilityLiveRegion="polite">
          {status}
        </Text>
      ) : null}
      <SectionList
        sections={sections}
        keyExtractor={(it) => it.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.list}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text style={s.group} accessibilityRole="header">
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => void open(item)}
            disabled={!!busy}
            accessibilityRole={item.target.kind === 'website' ? 'link' : 'button'}
            accessibilityLabel={item.label}
            accessibilityState={{ busy: busy === item.id, disabled: !!busy && busy !== item.id }}
            style={({ pressed }) => [s.row, pressed && s.pressed]}
          >
            {item.hint && item.target.kind !== 'website' ? <Text style={s.hint}>{item.hint}</Text> : null}
            <View style={s.flex}>
              <Text style={s.primary} numberOfLines={2}>
                {item.primary}
              </Text>
              {item.secondary || item.target.kind === 'website' ? (
                <Text style={s.secondary} numberOfLines={2}>
                  {item.secondary ?? item.hint}
                </Text>
              ) : null}
            </View>
            {busy === item.id ? <ActivityIndicator color={c.brand} /> : item.target.kind === 'website' ? <Text style={s.out}>↗</Text> : null}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.ground },
    flex: { flex: 1 },
    box: { flexDirection: 'row', alignItems: 'center', margin: spacing.lg, marginBottom: spacing.sm, borderWidth: 1, borderColor: c.line, borderRadius: radius.md, backgroundColor: c.surface },
    input: { flex: 1, minHeight: 48, paddingHorizontal: spacing.md, fontSize: fontSize.md, color: c.ink, textAlign: 'auto' },
    clear: { minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' },
    clearText: { fontSize: fontSize.md, color: c.ink2, fontWeight: '700' },
    status: { marginHorizontal: spacing.lg, marginBottom: spacing.sm, fontSize: fontSize.sm, color: c.ink2 },
    list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
    group: { fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: c.ink3, marginTop: spacing.md, marginBottom: spacing.xs },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.line, marginBottom: spacing.xs },
    pressed: { opacity: 0.7 },
    hint: { fontSize: fontSize.xs, fontWeight: '700', color: c.ink2, fontFamily: 'monospace' },
    primary: { fontSize: fontSize.md, color: c.ink, textAlign: 'auto' },
    secondary: { fontSize: fontSize.xs, color: c.ink3, textAlign: 'auto' },
    out: { fontSize: fontSize.md, color: c.brand, fontWeight: '700' },
  });
