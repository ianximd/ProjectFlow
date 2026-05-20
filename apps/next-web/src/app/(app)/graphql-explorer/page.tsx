import { requireSession } from '@/server/session';
import { GraphqlExplorerView } from './graphql-explorer-view';

export default async function GraphqlExplorerPage() {
  await requireSession();
  return <GraphqlExplorerView />;
}
