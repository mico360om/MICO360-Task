import { PageHeader } from '../components/ui/PageHeader';
import { InspectionFormsManager } from '../components/inspections/InspectionFormsManager';
import { usePageName } from '../lib/page-meta';

/**
 * A temporary home for the inspection forms manager (/inspection-forms, not in the menu): it moves to
 * the Templates page's "Inspection forms" tab when that page lands.
 */
export function InspectionFormsPage() {
  usePageName('Inspection forms');
  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Inspection forms" subtitle="The checklists inspections are carried out from" />
      <InspectionFormsManager />
    </div>
  );
}
