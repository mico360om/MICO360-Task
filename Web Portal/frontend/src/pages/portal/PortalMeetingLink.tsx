import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isNotShared, portal } from '../../api/portal';
import { portalKeys } from '../../components/portal/portal-queries';
import { LoadFailed, Loading, NotShared } from '../../components/portal/portal-ui';

/**
 * 1.23 An invitation email links to /meetings/<id> (the staff address). A client opening it comes
 * here: the portal asks the server which project the meeting is in, and opens it there — or says
 * it isn't shared with them.
 */
export function PortalMeetingLink() {
  const { meetingId = '' } = useParams();
  const q = useQuery({ queryKey: portalKeys.whereIs(meetingId), queryFn: () => portal.whereIs(meetingId), enabled: Boolean(meetingId) });
  if (q.isPending) return <Loading what="the meeting" />;
  if (q.isError) return isNotShared(q.error) ? <NotShared /> : <LoadFailed what="the meeting" onRetry={() => void q.refetch()} />;
  return <Navigate to={`/portal/projects/${encodeURIComponent(q.data.projectId)}/meetings/${encodeURIComponent(q.data.meetingId)}`} replace />;
}
