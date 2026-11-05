/**
 * 1.23 The Client portal, loaded as one piece (App.tsx imports each page from here): a client opening
 * the portal fetches its pages once, instead of one small file after another on a slow phone.
 */
export { PortalShell } from '../../components/portal/PortalShell';
export { PortalHomePage } from './PortalHomePage';
export { PortalProjectLayout, PortalProjectIndex } from './PortalProjectLayout';
export { PortalProgressTab } from './PortalProgressTab';
export { PortalTaskPage } from './PortalTaskPage';
export { PortalMeetingsTab } from './PortalMeetingsTab';
export { PortalMeetingPage } from './PortalMeetingPage';
export { PortalMeetingLink } from './PortalMeetingLink';
