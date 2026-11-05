// Handover UI (Forge UI Kit). Four tabs: Radar, People, Handover kit, Settings.
import React, { useEffect, useMemo, useState } from 'react';
import ForgeReconciler, {
  Box, Stack, Inline, Heading, Text, Strong, Lozenge, Button, ButtonGroup, DynamicTable, Tabs, TabList, Tab, TabPanel,
  ProgressBar, Select, DatePicker, Textfield, Toggle, SectionMessage, Spinner, EmptyState, Link, User, Tag, TagGroup,
  HorizontalStackBarChart, Label, Em,
} from '@forge/react';
import { invoke } from '@forge/bridge';

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
const pct = (x) => `${Math.round((x || 0) * 100)}%`;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const levelAppearance = { critical: 'removed', watch: 'moved', ok: 'success' };
const prioAppearance = { Highest: 'removed', High: 'removed', Medium: 'moved', Low: 'default', Lowest: 'default' };
const todayIso = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const RiskPill = ({ level, risk }) => <Lozenge appearance={levelAppearance[level]} isBold>{`${risk} ${level}`}</Lozenge>;

function Kpi({ label, value, hint }) {
  return (
    <Box padding="space.200" backgroundColor="color.background.neutral" xcss={{ borderRadius: 'border.radius', minWidth: '150px' }}>
      <Stack space="space.050">
        <Text>{label}</Text>
        <Heading size="large">{String(value)}</Heading>
        {hint ? <Text>{hint}</Text> : null}
      </Stack>
    </Box>
  );
}

// ---------------------------------------------------------------------------------------------
// Radar tab
// ---------------------------------------------------------------------------------------------
function Radar({ snapshot, absences, onSelectPerson, onRefresh, refreshing }) {
  const [selected, setSelected] = useState(null);
  if (!snapshot) {
    return (
      <EmptyState header="No analysis yet" description="Run the first analysis to find knowledge silos in your Jira and Confluence data." primaryAction={<Button appearance="primary" onClick={onRefresh} isLoading={refreshing}>Analyse now</Button>} />
    );
  }
  const area = snapshot.areas.find((a) => a.name === selected) || snapshot.areas[0];
  const head = {
    cells: ['Area', 'Silo risk', 'Bus factor', 'Main owner', 'Share', 'Open issues', 'Pages without owner'].map((c) => ({ key: c, content: c })),
  };
  const rows = snapshot.areas.map((a) => ({
    key: a.name,
    onClick: () => setSelected(a.name),
    cells: [
      { key: 'a', content: <Strong>{a.name}</Strong> },
      { key: 'r', content: <RiskPill level={a.level} risk={a.risk} /> },
      { key: 'b', content: <Lozenge appearance={a.busFactor === 1 ? 'removed' : a.busFactor === 2 ? 'moved' : 'success'}>{String(a.busFactor)}</Lozenge> },
      { key: 'o', content: a.owners[0] ? <Inline space="space.100" alignBlock="center"><Text>{a.owners[0].name}</Text>{a.owners[0].absent ? <Lozenge appearance="removed">away</Lozenge> : null}</Inline> : <Text>-</Text> },
      { key: 's', content: <Text>{pct(a.concentration)}</Text> },
      { key: 'i', content: <Text>{`${a.openIssues} (${a.highOpen} high)`}</Text> },
      { key: 'p', content: <Text>{String(a.unownedPages)}</Text> },
    ],
  }));
  const away = absences.filter((x) => x.to >= Date.now());
  return (
    <Stack space="space.300">
      <Inline space="space.200" shouldWrap>
        <Kpi label="Critical areas" value={snapshot.stats.critical} hint="silo risk 60 or more" />
        <Kpi label="Bus factor 1" value={snapshot.stats.singlePoints} hint={`of ${snapshot.stats.areas} areas`} />
        <Kpi label="Pages without owner" value={snapshot.stats.unownedPages} hint={`of ${snapshot.stats.pages} pages`} />
        <Kpi label="People analysed" value={snapshot.stats.people} hint={`${snapshot.stats.issues} issues scanned`} />
      </Inline>
      {away.length ? (
        <SectionMessage appearance="warning" title="Planned absences">
          <Text>{away.map((a) => `${a.personName} (${day(a.from)} to ${day(a.to)})`).join(', ')}</Text>
        </SectionMessage>
      ) : null}
      <Inline space="space.200" alignBlock="center">
        <Heading size="medium">Silo radar</Heading>
        <Text><Em>{`Updated ${new Date(snapshot.computedAt).toLocaleString('en-US')}`}</Em></Text>
        <Button onClick={onRefresh} isLoading={refreshing}>Re-analyse</Button>
        {snapshot.graph?.used ? (
          <Lozenge appearance={snapshot.graph.error ? 'moved' : 'success'}>{snapshot.graph.error ? 'Teamwork Graph: unavailable' : `Teamwork Graph: ${snapshot.graph.confirmedLinks} links confirmed`}</Lozenge>
        ) : null}
      </Inline>
      <DynamicTable head={head} rows={rows} rowsPerPage={10} />
      <Matrix snapshot={snapshot} />
      {area ? <AreaDetail area={area} onSelectPerson={onSelectPerson} /> : null}
    </Stack>
  );
}

function Matrix({ snapshot }) {
  const people = snapshot.people.slice(0, 6);
  const cell = (share) => {
    if (!share || share < 0.1) return <Text>-</Text>;
    const appearance = share >= 0.7 ? 'removed' : share >= 0.4 ? 'moved' : 'inprogress';
    return <Lozenge appearance={appearance} isBold={share >= 0.7}>{pct(share)}</Lozenge>;
  };
  return (
    <Stack space="space.100">
      <Heading size="small">Who knows what</Heading>
      <Text>Share of the knowledge per area. Red means one person carries it.</Text>
      <DynamicTable
        head={{ cells: [{ key: 'area', content: 'Area' }, ...people.map((p) => ({ key: p.id, content: p.name }))] }}
        rows={snapshot.areas.map((a) => ({
          key: a.name,
          cells: [{ key: 'n', content: <Strong>{a.name}</Strong> }, ...people.map((p) => ({ key: p.id, content: cell(a.owners.find((o) => o.id === p.id)?.share) }))],
        }))}
      />
    </Stack>
  );
}

function AreaDetail({ area, onSelectPerson }) {
  const chart = area.owners.slice(0, 6).map((o) => ({ x: area.name, y: Math.round(o.share * 100), color: o.name }));
  return (
    <Box padding="space.300" backgroundColor="color.background.neutral.subtle" xcss={{ borderRadius: 'border.radius' }}>
      <Stack space="space.200">
        <Inline space="space.200" alignBlock="center"><Heading size="medium">{area.name}</Heading><RiskPill level={area.level} risk={area.risk} /></Inline>
        <Text>{`Bus factor ${area.busFactor}. ${area.owners[0] ? `${area.owners[0].name} carries ${pct(area.concentration)} of the knowledge.` : ''} ${area.openIssues} open issues, ${area.highOpen} high priority.`}</Text>
        <HorizontalStackBarChart data={chart} xAccessor="y" yAccessor="x" colorAccessor="color" />
        <DynamicTable
          head={{ cells: ['Person', 'Share', 'Open assigned', 'Pages', 'Signals'].map((c) => ({ key: c, content: c })) }}
          rows={area.owners.slice(0, 6).map((o) => ({
            key: o.id,
            cells: [
              { key: 'n', content: <Link href="#" onClick={() => onSelectPerson(o.id)}>{o.name}</Link> },
              { key: 's', content: <Text>{pct(o.share)}</Text> },
              { key: 'a', content: <Text>{String(o.assignedOpen)}</Text> },
              { key: 'p', content: <Text>{String(o.pages)}</Text> },
              { key: 'g', content: <Inline space="space.050">{o.graphConfirmed ? <Lozenge appearance="success">graph-confirmed</Lozenge> : null}{o.absent ? <Lozenge appearance="removed">away</Lozenge> : null}</Inline> },
            ],
          }))}
        />
        {area.pages.length ? (
          <Stack space="space.050">
            <Strong>Pages</Strong>
            {area.pages.map((p) => (
              <Inline key={p.id} space="space.100" alignBlock="center"><Link href={p.url} openNewTab>{p.title}</Link>{p.unowned ? <Lozenge appearance="removed">no owner</Lozenge> : null}</Inline>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}

// ---------------------------------------------------------------------------------------------
// People tab
// ---------------------------------------------------------------------------------------------
function People({ snapshot, onKit }) {
  if (!snapshot) return <Text>Run an analysis first.</Text>;
  const head = { cells: ['Person', 'Exposure', 'Main owner of', 'Open assigned', 'Status', ''].map((c, i) => ({ key: `h${i}`, content: c })) };
  const rows = snapshot.people.map((p) => ({
    key: p.id,
    cells: [
      { key: 'n', content: <Strong>{p.name}</Strong> },
      { key: 'e', content: <ProgressBar value={Math.min(1, p.exposure / 200)} appearance={p.exposure >= 120 ? 'default' : 'success'} /> },
      { key: 'o', content: <TagGroup>{p.ownedAreas.map((a) => <Tag key={a.name} text={`${a.name} (${a.risk})`} />)}</TagGroup> },
      { key: 'a', content: <Text>{String(p.openAssigned)}</Text> },
      { key: 's', content: p.absent ? <Lozenge appearance="removed">away</Lozenge> : <Lozenge appearance="success">available</Lozenge> },
      { key: 'k', content: <Button appearance="primary" onClick={() => onKit(p.id)}>Handover kit</Button> },
    ],
  }));
  return (
    <Stack space="space.200">
      <Text>Exposure is the sum of silo risk over the areas where a person is the main owner. High exposure means a single absence hurts.</Text>
      <DynamicTable head={head} rows={rows} />
    </Stack>
  );
}

// ---------------------------------------------------------------------------------------------
// Kit tab
// ---------------------------------------------------------------------------------------------
function KitTab({ snapshot, personId, setPersonId, onPublished }) {
  const [from, setFrom] = useState(plusDays(7));
  const [to, setTo] = useState(plusDays(14));
  const [reason, setReason] = useState('Vacation');
  const [createTasks, setCreateTasks] = useState(true);
  const [comment, setComment] = useState(false);
  const [busy, setBusy] = useState('');
  const [kit, setKit] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const options = useMemo(() => (snapshot?.people || []).map((p) => ({ label: p.name, value: p.id })), [snapshot]);

  if (!snapshot) return <Text>Run an analysis first.</Text>;

  const run = async (kind) => {
    setBusy(kind); setError(''); if (kind === 'preview') setResult(null);
    try {
      if (kind === 'preview') setKit((await invoke('getKit', { personId, from, to, reason })).kit);
      else { const r = await invoke('publishKit', { personId, from, to, reason, createTasks, commentOnIssues: comment }); setResult(r); onPublished(); }
    } catch (e) { setError(String(e?.message || e)); }
    setBusy('');
  };

  return (
    <Stack space="space.300">
      <Inline space="space.200" alignBlock="end" shouldWrap>
        <Box xcss={{ minWidth: '240px' }}>
          <Label labelFor="person">Person</Label>
          <Select inputId="person" options={options} value={options.find((o) => o.value === personId)} onChange={(o) => { setPersonId(o.value); setKit(null); setResult(null); }} placeholder="Choose a person" />
        </Box>
        <Box><Label labelFor="from">From</Label><DatePicker id="from" value={from} onChange={setFrom} /></Box>
        <Box><Label labelFor="to">To</Label><DatePicker id="to" value={to} onChange={setTo} /></Box>
        <Box xcss={{ minWidth: '160px' }}><Label labelFor="reason">Reason</Label><Textfield id="reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Box>
        <Button appearance="primary" isDisabled={!personId} isLoading={busy === 'preview'} onClick={() => run('preview')}>Preview kit</Button>
      </Inline>
      {error ? <SectionMessage appearance="error" title="Something went wrong"><Text>{error}</Text></SectionMessage> : null}
      {busy === 'preview' ? <Inline space="space.100"><Spinner size="small" /><Text>Reading Jira, Confluence and Teamwork Graph...</Text></Inline> : null}
      {kit ? <KitView kit={kit} /> : <Text>Pick a person and dates, then preview the kit. Nothing is written until you publish.</Text>}
      {kit ? (
        <Box padding="space.200" backgroundColor="color.background.neutral" xcss={{ borderRadius: 'border.radius' }}>
          <Stack space="space.150">
            <Heading size="small">Publish</Heading>
            <Inline space="space.100" alignBlock="center"><Toggle isChecked={createTasks} onChange={() => setCreateTasks(!createTasks)} /><Text>{`Create ${kit.followUps.length} follow-up task(s) assigned to the backups`}</Text></Inline>
            <Inline space="space.100" alignBlock="center"><Toggle isChecked={comment} onChange={() => setComment(!comment)} /><Text>Add a handover note comment to each in-flight issue</Text></Inline>
            <Button appearance="primary" isLoading={busy === 'publish'} onClick={() => run('publish')}>Publish to Confluence and Jira</Button>
          </Stack>
        </Box>
      ) : null}
      {result ? (
        <SectionMessage appearance="success" title="Handover kit published">
          <Stack space="space.100">
            <Link href={result.page.url} openNewTab>{result.page.title}</Link>
            {result.tasks.length ? <Text>{`Follow-ups: ${result.tasks.map((t) => (t.key ? `${t.key}` : 'failed')).join(', ')}`}</Text> : null}
            <Text>The absence was recorded, so the radar now treats this person as away.</Text>
          </Stack>
        </SectionMessage>
      ) : null}
    </Stack>
  );
}

function KitView({ kit }) {
  return (
    <Stack space="space.300">
      <Inline space="space.200" shouldWrap>
        <Kpi label="In-flight issues" value={kit.summary.inFlight} />
        <Kpi label="Areas owned" value={kit.summary.ownedAreas} hint={`${kit.summary.criticalAreas} critical`} />
        <Kpi label="Decisions found" value={kit.summary.decisions} />
        <Kpi label="Open risks" value={kit.summary.risks} />
      </Inline>

      <Heading size="small">Who to ask instead</Heading>
      <DynamicTable
        head={{ cells: ['Area', 'Risk', 'Backups'].map((c) => ({ key: c, content: c })) }}
        rows={kit.whoToAsk.map((w) => ({
          key: w.area,
          cells: [
            { key: 'a', content: <Strong>{w.area}</Strong> },
            { key: 'r', content: <RiskPill level={kit.ownedAreas.find((o) => o.name === w.area)?.level || 'ok'} risk={w.risk} /> },
            { key: 'b', content: w.people.length ? <Inline space="space.100" shouldWrap>{w.people.slice(0, 3).map((p) => <Tag key={p.id} text={`${p.name} ${pct(p.share)}${p.available ? '' : ' (away)'}`} />)}</Inline> : <Lozenge appearance="removed">nobody</Lozenge> },
          ],
        }))}
      />

      <Heading size="small">In-flight work</Heading>
      <DynamicTable
        head={{ cells: ['Issue', 'Status', 'Priority', 'Due', 'Next step', 'Suggested owner'].map((c) => ({ key: c, content: c })) }}
        rows={kit.inFlight.map((i) => ({
          key: i.key,
          cells: [
            { key: 'k', content: <Stack space="space.050"><Link href={i.url} openNewTab>{i.key}</Link><Text>{i.summary}</Text></Stack> },
            { key: 's', content: <Inline space="space.050"><Text>{i.status}</Text>{i.blocked ? <Lozenge appearance="removed">blocked</Lozenge> : null}</Inline> },
            { key: 'p', content: <Lozenge appearance={prioAppearance[i.priority] || 'default'}>{i.priority}</Lozenge> },
            { key: 'd', content: <Inline space="space.050"><Text>{i.due || '-'}</Text>{i.overdue ? <Lozenge appearance="removed">overdue</Lozenge> : null}</Inline> },
            { key: 'n', content: <Text>{i.nextStep}</Text> },
            { key: 'o', content: <Text>{i.suggestedOwner?.name || '-'}</Text> },
          ],
        }))}
      />

      <Heading size="small">Decisions found in comments</Heading>
      {kit.decisions.length ? (
        <Stack space="space.100">
          {kit.decisions.map((d, idx) => (
            <Box key={`${d.key}-${idx}`} padding="space.100" backgroundColor="color.background.neutral.subtle" xcss={{ borderRadius: 'border.radius' }}>
              <Stack space="space.050"><Inline space="space.100"><Link href={d.url} openNewTab>{d.key}</Link><Tag text={d.area || 'no area'} /><Text>{d.author || ''}</Text></Inline><Text>{d.text}</Text></Stack>
            </Box>
          ))}
        </Stack>
      ) : <Text>None found.</Text>}

      <Heading size="small">Open risks</Heading>
      {kit.risks.length ? (
        <Stack space="space.075">
          {kit.risks.map((r, idx) => <Inline key={idx} space="space.100"><Lozenge appearance={r.severity === 'high' ? 'removed' : 'moved'}>{r.severity}</Lozenge><Text>{r.text}</Text></Inline>)}
        </Stack>
      ) : <Text>None detected.</Text>}

      {kit.pages.length ? (
        <Stack space="space.075">
          <Heading size="small">Key pages</Heading>
          {kit.pages.map((p) => <Inline key={p.id} space="space.100"><Link href={p.url} openNewTab>{p.title}</Link><Tag text={p.role} />{p.tribal ? <Lozenge appearance="removed">knowledge outside docs</Lozenge> : null}</Inline>)}
        </Stack>
      ) : null}
    </Stack>
  );
}

// ---------------------------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------------------------
function Settings({ config, me, absences, kits, history, onSaved, onAbsences }) {
  const [projects, setProjects] = useState((config.projectKeys || []).join(', '));
  const [spaces, setSpaces] = useState((config.spaceKeys || []).join(', '));
  const [ignored, setIgnored] = useState((config.ignoredAccountIds || []).join(', '));
  const [kitSpace, setKitSpace] = useState(config.kitSpaceKey || '');
  const [names, setNames] = useState(Object.entries(config.nameOverrides || {}).map(([k, v]) => `${k}=${v}`).join('; '));
  const [followProject, setFollowProject] = useState(config.followUpProjectKey || '');
  const [weeklyOn, setWeeklyOn] = useState(config.weekly.enabled);
  const [pairing, setPairing] = useState(config.weekly.createPairingTasks);
  const [useGraph, setUseGraph] = useState(!!config.useGraph);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

  const save = async () => {
    setBusy(true);
    await invoke('saveConfig', { ...config, projectKeys: list(projects).map((k) => k.toUpperCase()), spaceKeys: list(spaces), ignoredAccountIds: list(ignored), useGraph, nameOverrides: Object.fromEntries(names.split(';').map((x) => x.split('=').map((y) => y.trim())).filter((x) => x[0] && x[1])), kitSpaceKey: kitSpace.trim(), followUpProjectKey: followProject.trim().toUpperCase(), weekly: { ...config.weekly, enabled: weeklyOn, createPairingTasks: pairing } });
    setMsg('Settings saved. Re-analyse to apply them.'); setBusy(false); onSaved();
  };
  const runWeekly = async () => {
    setBusy(true); setMsg('');
    try { const r = await invoke('runWeekly'); setMsg(`Weekly report published${r.page?.url ? `: ${r.page.url}` : ''}. Pairing tasks created: ${r.tasks.length}.`); onSaved(); } catch (e) { setMsg(`Failed: ${String(e?.message || e)}`); }
    setBusy(false);
  };

  return (
    <Stack space="space.300">
      <Heading size="medium">Scope</Heading>
      <Text>Leave a field empty to include everything the current user can see.</Text>
      <Inline space="space.200" shouldWrap>
        <Box xcss={{ minWidth: '260px' }}><Label labelFor="projects">Jira project keys</Label><Textfield id="projects" value={projects} placeholder="NWP, PAY" onChange={(e) => setProjects(e.target.value)} /></Box>
        <Box xcss={{ minWidth: '260px' }}><Label labelFor="spaces">Confluence space keys</Label><Textfield id="spaces" value={spaces} placeholder="NWP" onChange={(e) => setSpaces(e.target.value)} /></Box>
      </Inline>
      <Box xcss={{ maxWidth: '540px' }}><Label labelFor="ignored">Ignore accounts (account IDs, comma separated; admins, bots, service accounts)</Label><Textfield id="ignored" value={ignored} onChange={(e) => setIgnored(e.target.value)} /></Box>
      <Box xcss={{ maxWidth: '540px' }}><Label labelFor="names">Name overrides (accountId=Name; accountId=Name)</Label><Textfield id="names" value={names} onChange={(e) => setNames(e.target.value)} /></Box>
      <Inline space="space.100" alignBlock="center"><Button onClick={() => { if (!ignored.includes(me)) setIgnored(ignored ? `${ignored}, ${me}` : me); }}>Ignore my own account</Button><Text>Use this when the admin who set up the site is not part of the team.</Text></Inline>
      <Heading size="medium">Output</Heading>
      <Inline space="space.200" shouldWrap>
        <Box xcss={{ minWidth: '260px' }}><Label labelFor="kitspace">Space for handover pages</Label><Textfield id="kitspace" value={kitSpace} placeholder="NWP" onChange={(e) => setKitSpace(e.target.value)} /></Box>
        <Box xcss={{ minWidth: '260px' }}><Label labelFor="fp">Project for follow-up tasks</Label><Textfield id="fp" value={followProject} placeholder="NWP" onChange={(e) => setFollowProject(e.target.value)} /></Box>
      </Inline>
      <Heading size="medium">Teamwork Graph</Heading>
      <Inline space="space.100" alignBlock="center"><Toggle isChecked={useGraph} onChange={() => setUseGraph(!useGraph)} /><Text>Cross-check ownership with Teamwork Graph (adds a graph-confirmed badge)</Text></Inline>
      <Heading size="medium">Weekly silo report</Heading>
      <Inline space="space.100" alignBlock="center"><Toggle isChecked={weeklyOn} onChange={() => setWeeklyOn(!weeklyOn)} /><Text>Publish the Weekly Silo Report page every week</Text></Inline>
      <Inline space="space.100" alignBlock="center"><Toggle isChecked={pairing} onChange={() => setPairing(!pairing)} /><Text>Create pairing tasks for the riskiest areas</Text></Inline>
      <ButtonGroup>
        <Button appearance="primary" onClick={save} isLoading={busy}>Save settings</Button>
        <Button onClick={runWeekly} isLoading={busy}>Run weekly report now</Button>
        <Button onClick={async () => { setMsg(`Access check: ${JSON.stringify(await invoke('diagnose'))}`); }}>Check access</Button>
        <Button onClick={async () => { await invoke('resetState'); setMsg('Stored analysis, absences, history and kit records were cleared.'); onSaved(); }}>Clear stored data</Button>
        <Button onClick={async () => { setMsg('Testing the agent actions...'); try { setMsg(`Agent actions OK: ${JSON.stringify(await invoke('testActions'))}`); } catch (e) { setMsg(`Agent actions failed: ${String(e?.message || e)}`); } }}>Test agent actions</Button>
      </ButtonGroup>
      {msg ? <SectionMessage appearance="information"><Text>{msg}</Text></SectionMessage> : null}

      <Heading size="medium">Recorded absences</Heading>
      {absences.length ? (
        <DynamicTable
          head={{ cells: ['Person', 'From', 'To', 'Reason', ''].map((c, i) => ({ key: `a${i}`, content: c })) }}
          rows={absences.map((a) => ({ key: `${a.personId}-${a.from}`, cells: [
            { key: 'p', content: <Text>{a.personName}</Text> }, { key: 'f', content: <Text>{day(a.from)}</Text> }, { key: 't', content: <Text>{day(a.to)}</Text> }, { key: 'r', content: <Text>{a.reason}</Text> },
            { key: 'x', content: <Button onClick={async () => { await invoke('removeAbsence', { personId: a.personId, from: a.from }); onAbsences(); }}>Remove</Button> },
          ] }))}
        />
      ) : <Text>No absences recorded.</Text>}

      <Heading size="medium">Published kits</Heading>
      {kits.length ? <Stack space="space.050">{kits.map((k) => <Inline key={`${k.personId}-${k.at}`} space="space.100"><Link href={k.pageUrl} openNewTab>{k.pageTitle}</Link><Text>{`${k.tasks.length} task(s)`}</Text></Inline>)}</Stack> : <Text>None yet.</Text>}
      {history.length > 1 ? <Text>{`Trend: average silo risk ${history[history.length - 2].avgRisk} -> ${history[history.length - 1].avgRisk} over the last two weekly runs.`}</Text> : null}
    </Stack>
  );
}

// ---------------------------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------------------------
function App() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [personId, setPersonId] = useState(null);
  const [tab, setTab] = useState(0);

  const load = async () => { try { setState(await invoke('getState')); } catch (e) { setError(String(e?.message || e)); } };
  useEffect(() => { load(); }, []);

  const refresh = async () => {
    setRefreshing(true); setError('');
    try { await invoke('refresh'); await load(); } catch (e) { setError(String(e?.message || e)); }
    setRefreshing(false);
  };
  const toKit = (id) => { setPersonId(id); setTab(2); };

  if (!state) return error ? <SectionMessage appearance="error" title="Could not load Handover"><Text>{error}</Text></SectionMessage> : <Spinner size="large" />;

  return (
    <Stack space="space.200">
      <Text>Find knowledge silos before they hurt, and hand work over in minutes.</Text>
      {error ? <SectionMessage appearance="error" title="Error"><Text>{error}</Text></SectionMessage> : null}
      <Tabs id="handover-tabs" selected={tab} onChange={setTab}>
        <TabList><Tab>Radar</Tab><Tab>People</Tab><Tab>Handover kit</Tab><Tab>Settings</Tab></TabList>
        <TabPanel><Box paddingBlockStart="space.200"><Radar snapshot={state.snapshot} absences={state.absences} onSelectPerson={toKit} onRefresh={refresh} refreshing={refreshing} /></Box></TabPanel>
        <TabPanel><Box paddingBlockStart="space.200"><People snapshot={state.snapshot} onKit={toKit} /></Box></TabPanel>
        <TabPanel><Box paddingBlockStart="space.200"><KitTab snapshot={state.snapshot} personId={personId} setPersonId={setPersonId} onPublished={load} /></Box></TabPanel>
        <TabPanel><Box paddingBlockStart="space.200"><Settings config={state.config} me={state.me} absences={state.absences} kits={state.kits} history={state.history} onSaved={load} onAbsences={load} /></Box></TabPanel>
      </Tabs>
    </Stack>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
