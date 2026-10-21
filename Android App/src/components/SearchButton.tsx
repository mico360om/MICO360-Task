import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useColors } from '../core/theme';
import { navigationRef } from '../navigation/ref';
import { spacing } from '../lib/theme';

/** The 🔍 in the tabs' headers: opens Search, as the website's search box on every page (6b). */
export function SearchButton() {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search"
      accessibilityHint="Finds tasks, projects, people, meetings and pages"
      hitSlop={8}
      onPress={() => {
        if (navigationRef.isReady()) navigationRef.navigate('Search');
      }}
      style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md }}
    >
      <Text style={{ fontSize: 18, color: c.onBrand }}>🔍</Text>
    </Pressable>
  );
}

/**
 * A tab's own header buttons (Chat's ＋, Projects' + New) after the 🔍: a tab that sets its header's
 * right side replaces the tabs' shared Search button, so it puts it back here. Every tab's
 * `headerRight` uses this (navigation/tab-headers.test).
 */
export function TabHeaderButtons({ children }: { children?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <SearchButton />
      {children}
    </View>
  );
}
