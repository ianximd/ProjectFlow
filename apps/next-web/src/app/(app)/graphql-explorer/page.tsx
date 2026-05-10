'use client';

import { useState } from 'react';
import styles from './page.module.css';

const EXAMPLE_QUERIES = {
  Projects: `query Projects($workspaceId: String!) {
  projects(workspaceId: $workspaceId) {
    id
    name
    key
    type
    status
    createdAt
  }
}`,
  Tasks: `query Tasks($projectId: String!) {
  tasks(projectId: $projectId, pageSize: 10) {
    id
    issueKey
    title
    status
    priority
    storyPoints
    createdAt
  }
}`,
  CreateTask: `mutation CreateTask($input: CreateTaskInput!) {
  createTask(input: $input) {
    id
    issueKey
    title
    status
  }
}`,
  TransitionTask: `mutation TransitionTask($id: String!, $status: String!) {
  transitionTask(id: $id, status: $status) {
    id
    issueKey
    status
    updatedAt
  }
}`,
  TaskSubscription: `subscription TaskUpdated($projectId: String!) {
  taskUpdated(projectId: $projectId) {
    id
    issueKey
    title
    status
    updatedAt
  }
}`,
  Me: `query Me {
  me {
    id
    name
    email
    avatarUrl
    isEmailVerified
  }
}`,
};

const API_URL = '/api/v1/graphql';

async function execQuery(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const res = await fetch(API_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': token ? `Bearer ${token}` : '',
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

export default function GraphQLExplorerPage() {
  const [query, setQuery]         = useState(EXAMPLE_QUERIES.Me);
  const [variables, setVariables] = useState('{}');
  const [token, setToken]         = useState('');
  const [result, setResult]       = useState<string>('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string>('');

  const run = async () => {
    setError('');
    setResult('');
    let vars: Record<string, unknown> = {};
    try {
      vars = JSON.parse(variables || '{}');
    } catch {
      setError('Variables are not valid JSON');
      return;
    }
    setLoading(true);
    try {
      const data = await execQuery(query, vars, token);
      setResult(JSON.stringify(data, null, 2));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>GraphQL API Explorer</h1>
        <p className={styles.subtitle}>
          Endpoint: <code className={styles.code}>{API_URL}</code>
          {' · '}
          Interactive playground available at{' '}
          <a className={styles.link} href={API_URL} target="_blank" rel="noreferrer">
            {API_URL}
          </a>
        </p>
      </div>

      <div className={styles.toolbar}>
        <label className={styles.label}>Bearer token (JWT)</label>
        <input
          className={styles.tokenInput}
          type="password"
          placeholder="Paste your JWT access token…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>

      <div className={styles.examples}>
        {Object.entries(EXAMPLE_QUERIES).map(([name, q]) => (
          <button
            key={name}
            className={`${styles.exampleBtn} ${query === q ? styles.exampleBtnActive : ''}`}
            onClick={() => setQuery(q)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className={styles.editor}>
        <div className={styles.editorPane}>
          <div className={styles.paneHeader}>Query / Mutation</div>
          <textarea
            className={styles.textarea}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
        </div>

        <div className={styles.editorPane}>
          <div className={styles.paneHeader}>Variables (JSON)</div>
          <textarea
            className={styles.textarea}
            value={variables}
            onChange={(e) => setVariables(e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>

      <div className={styles.runRow}>
        <button className={styles.runBtn} onClick={run} disabled={loading}>
          {loading ? 'Running…' : '▶ Run Query'}
        </button>
        {error && <span className={styles.errorMsg}>{error}</span>}
      </div>

      {result && (
        <div className={styles.resultPane}>
          <div className={styles.paneHeader}>Response</div>
          <pre className={styles.result}>{result}</pre>
        </div>
      )}

      <div className={styles.schemaCard}>
        <h2 className={styles.schemaTitle}>Available Operations</h2>
        <div className={styles.schemaGrid}>
          <div>
            <h3 className={styles.opGroup}>Queries</h3>
            <ul className={styles.opList}>
              <li><code>me</code> — authenticated user</li>
              <li><code>workspaces</code> — all user workspaces</li>
              <li><code>workspace(id)</code> — single workspace</li>
              <li><code>projects(workspaceId)</code> — projects list</li>
              <li><code>project(id)</code> — single project</li>
              <li><code>sprints(projectId)</code> — sprints list</li>
              <li><code>tasks(projectId, status?, sprintId?, page?, pageSize?)</code></li>
              <li><code>task(id)</code> — single task</li>
              <li><code>comments(taskId)</code> — comments on a task</li>
              <li><code>notifications(page?, pageSize?, unreadOnly?)</code></li>
            </ul>
          </div>
          <div>
            <h3 className={styles.opGroup}>Mutations</h3>
            <ul className={styles.opList}>
              <li><code>createTask(input)</code></li>
              <li><code>updateTask(id, input)</code></li>
              <li><code>transitionTask(id, status)</code></li>
              <li><code>deleteTask(id)</code></li>
              <li><code>createComment(taskId, body)</code></li>
              <li><code>markNotificationRead(id)</code></li>
              <li><code>markAllNotificationsRead</code></li>
            </ul>
            <h3 className={styles.opGroup}>Subscriptions (SSE)</h3>
            <ul className={styles.opList}>
              <li><code>taskUpdated(projectId)</code></li>
              <li><code>commentAdded(taskId)</code></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
