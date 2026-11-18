import { useParams } from 'react-router-dom';
import { PageTitle } from '../../components/ui/PageHeader';
import { LessonPlayer } from '../../components/training/LessonPlayer';
import { useLessonView } from '../../components/training/training-queries';
import { usePageName } from '../../lib/page-meta';

/** One lesson of a course (staff): a video, a guide, a document or a quiz. */
export function LessonPage() {
  const { courseId = '', lessonId = '' } = useParams();
  usePageName(useLessonView(lessonId).data?.title);
  return <LessonPlayer key={lessonId} courseId={courseId} lessonId={lessonId} renderTitle={(title) => <PageTitle wrap title={title} />} />;
}
