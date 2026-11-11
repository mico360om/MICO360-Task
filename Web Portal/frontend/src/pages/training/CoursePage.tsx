import { useParams } from 'react-router-dom';
import { PageHeader } from '../../components/ui/PageHeader';
import { CourseView } from '../../components/training/CourseView';
import { usePageName } from '../../lib/page-meta';
import { useCourse } from '../../components/training/training-queries';

/** One course (staff): what it is, its lessons, the certificate, rating and questions. */
export function CoursePage() {
  const { id = '' } = useParams();
  usePageName(useCourse(id).data?.title);
  return <CourseView key={id} courseId={id} renderHeader={(title) => <PageHeader title={title} />} />;
}
