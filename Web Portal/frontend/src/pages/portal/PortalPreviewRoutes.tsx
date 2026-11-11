import { Navigate, Route, Routes } from 'react-router-dom';
import { PortalShell } from '../../components/portal/PortalShell';
import { PortalHomePage } from './PortalHomePage';
import { PortalMeetingPage } from './PortalMeetingPage';
import { PortalMeetingsTab } from './PortalMeetingsTab';
import { PortalNotificationsPage } from './PortalNotificationsPage';
import { PortalProgressTab } from './PortalProgressTab';
import { PortalProjectIndex, PortalProjectLayout } from './PortalProjectLayout';
import { PortalSettingsPage } from './PortalSettingsPage';
import { PortalTaskPage } from './PortalTaskPage';
import { PortalTrainingCoursePage, PortalTrainingLessonPage, PortalTrainingPage } from './PortalTrainingPage';

/**
 * 1.23.7 The Client portal's pages for Preview as client (inside its own memory router): the same pages
 * and addresses as the client's portal in App.tsx — kept in step by a test — except the invitation
 * email's /portal/meetings/<id> link, which a preview never follows.
 */
export function PortalPreviewRoutes() {
  return (
    <Routes>
      <Route element={<PortalShell />}>
        <Route path="/portal" element={<PortalHomePage />} />
        <Route path="/portal/notifications" element={<PortalNotificationsPage />} />
        <Route path="/portal/settings" element={<PortalSettingsPage />} />
        <Route path="/portal/training" element={<PortalTrainingPage />} />
        <Route path="/portal/training/courses/:id" element={<PortalTrainingCoursePage />} />
        <Route path="/portal/training/courses/:courseId/lessons/:lessonId" element={<PortalTrainingLessonPage />} />
        <Route path="/portal/projects/:projectId" element={<PortalProjectLayout />}>
          <Route index element={<PortalProjectIndex />} />
          <Route path="progress" element={<PortalProgressTab />} />
          <Route path="tasks/:taskId" element={<PortalTaskPage />} />
          <Route path="meetings" element={<PortalMeetingsTab />} />
          <Route path="meetings/:meetingId" element={<PortalMeetingPage />} />
          <Route path="*" element={<PortalProjectIndex />} />
        </Route>
        <Route path="*" element={<Navigate to="/portal" replace />} />
      </Route>
    </Routes>
  );
}
