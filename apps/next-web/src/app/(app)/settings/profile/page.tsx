import { requireSession } from '@/server/session';
import { getMe } from '@/server/queries/profile';
import { ProfileView } from './profile-view';

export default async function ProfileSettingsPage() {
  await requireSession();
  const me = await getMe();
  return <ProfileView me={me} />;
}
