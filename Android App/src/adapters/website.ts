import { Alert, Linking } from 'react-native';
import { websiteOpenFailed, websitePageUrl } from '../lib/website';

/**
 * Open one of the website's own pages (lib/website) in the browser. Only its known pages, on the
 * connected server; when no browser opens, the address is shown to type in.
 */
export function openWebsitePage(apiBase: string, path: string): void {
  const url = websitePageUrl(apiBase, path);
  if (!url) return;
  Linking.openURL(url).catch(() => {
    const f = websiteOpenFailed(url);
    Alert.alert(f.title, f.message);
  });
}
