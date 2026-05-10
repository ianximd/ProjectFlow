'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import { Layout } from '@/components/Layout';

export default function SetupPage() {
  const router = useRouter();
  const accessToken = useStore((s) => s.accessToken);
  
  const [workspaceName, setWorkspaceName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const setupMutation = useMutation({
    mutationFn: async () => {
      // 1. Create Workspace
      const wsRes = await fetch('http://localhost:3001/api/v1/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          name: workspaceName,
          slug: workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now()
        })
      });
      const wsData = await wsRes.json();
      if (!wsRes.ok) throw new Error(wsData.error?.message || 'Failed to create workspace');
      const workspaceId = wsData.data.Id;

      // 2. Create Project
      const projRes = await fetch('http://localhost:3001/api/v1/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          workspaceId,
          name: projectName,
          key: projectName.substring(0, 4).toUpperCase() || 'PROJ',
          type: 'SCRUM'
        })
      });
      const projData = await projRes.json();
      if (!projRes.ok) throw new Error(projData.error?.message || 'Failed to create project');
      
      return projData.data;
    },
    onSuccess: () => {
      router.push('/board');
    },
    onError: (error: Error) => {
      setErrorMsg(error.message);
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setupMutation.mutate();
  };

  if (!accessToken) {
    router.push('/login');
    return null;
  }

  return (
    <Layout>
      <div style={{ maxWidth: '400px', margin: '100px auto', padding: '20px', border: '1px solid #eaeaea', borderRadius: '8px', background: '#fff' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>Welcome to ProjectFlow!</h1>
        <p style={{ color: '#666', marginBottom: '24px' }}>Let's set up your first Workspace and Project to get started.</p>
        
        {errorMsg && <div style={{ color: 'red', marginBottom: '16px', fontSize: '14px' }}>{errorMsg}</div>}
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500' }}>Workspace Name</label>
            <input 
              type="text" 
              required 
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="e.g. Acme Corp"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500' }}>Project Name</label>
            <input 
              type="text" 
              required 
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Website Redesign"
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: '4px' }}
            />
          </div>
          <button 
            type="submit" 
            disabled={setupMutation.isPending}
            style={{ 
              background: '#0052cc', 
              color: 'white', 
              padding: '10px 16px', 
              border: 'none', 
              borderRadius: '4px', 
              fontWeight: '500',
              cursor: setupMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: setupMutation.isPending ? 0.7 : 1
            }}
          >
            {setupMutation.isPending ? 'Setting up...' : 'Create and Continue'}
          </button>
        </form>
      </div>
    </Layout>
  );
}
