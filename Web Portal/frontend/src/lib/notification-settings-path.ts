/** System Settings → Notification & Scheduling's address: a tab (and a company) to open. */
export function notificationSettingsPath(tab?: string, companyId?: string): string {
  const p = new URLSearchParams();
  if (tab) p.set('tab', tab);
  if (companyId) p.set('company', companyId);
  const qs = p.toString();
  return `/admin/settings/notifications${qs ? `?${qs}` : ''}`;
}
