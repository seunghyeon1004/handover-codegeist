// Issue panel: shows how concentrated the knowledge is for the area (component) of the issue being viewed.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Stack, Inline, Text, Strong, Lozenge, Spinner, SectionMessage } from '@forge/react';
import { invoke } from '@forge/bridge';

const appearance = { critical: 'removed', watch: 'moved', ok: 'success' };

function Panel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { invoke('issueRisk').then(setData).catch((e) => setError(String(e?.message || e))); }, []);
  if (error) return <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>;
  if (!data) return <Spinner size="small" />;
  if (data.empty) return <Text>{data.reason}</Text>;
  if (!data.areas.length) return <Text>This issue has no component, so Handover cannot place it in an area.</Text>;
  return (
    <Stack space="space.150">
      {data.areas.map((a) => (
        <Stack key={a.name} space="space.050">
          <Inline space="space.100" alignBlock="center">
            <Strong>{a.name}</Strong>
            <Lozenge appearance={appearance[a.level]} isBold>{`${a.risk} ${a.level}`}</Lozenge>
            <Lozenge appearance={a.busFactor === 1 ? 'removed' : 'success'}>{`bus factor ${a.busFactor}`}</Lozenge>
          </Inline>
          <Text>{`Ask: ${a.owners.map((o) => `${o.name} ${Math.round(o.share * 100)}%${o.away ? ' (away)' : ''}`).join(', ')}`}</Text>
        </Stack>
      ))}
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><Panel /></React.StrictMode>);
