import { requireSession } from '@/server/session';
import { SetupView } from './setup-view';

export default async function SetupPage() {
  await requireSession();
  return <SetupView />;
}
