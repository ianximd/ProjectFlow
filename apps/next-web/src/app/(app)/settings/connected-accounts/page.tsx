import { requireSession } from '@/server/session';
import { getOAuthProviders, getOAuthIdentities } from '@/server/queries/oauth';
import { ConnectedAccountsView } from './connected-accounts-view';

export default async function ConnectedAccountsPage() {
  await requireSession();
  const [providers, identities] = await Promise.all([
    getOAuthProviders(),
    getOAuthIdentities(),
  ]);
  return <ConnectedAccountsView providers={providers} identities={identities} />;
}
