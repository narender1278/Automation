/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { FixedSidebar } from './components/FixedSidebar';
import { FixedTopBar } from './components/FixedTopBar';
import { Stage1Niche } from './components/Stage1Niche';
import { Stage2Ideas } from './components/Stage2Ideas';
import { Stage3Script } from './components/Stage3Script';
import { Stage4Visuals3D } from './components/Stage4Visuals3D';
import { Stage5Packaging } from './components/Stage5Packaging';
import { Stage6Growth } from './components/Stage6Growth';
import { DailyVaultView } from './components/DailyVaultView';
import { buildProjectMarkdown } from './utils/exportMarkdown';
import type {
  AutomationSettings,
  ContentIdea,
  DailyEpisode,
  SceneItem,
  StageId,
  StudioProject,
  VaultStateResponse,
} from './types/studio';

const STAGE_META: Record<StageId, { title: string; cta: string }> = {
  1: { title: 'The Profitable Niche', cta: 'Analyze Niche' },
  2: { title: 'Daily Idea Generator', cta: 'Generate 3 Ideas' },
  3: { title: 'Faceless Script Generator', cta: 'Write Script' },
  4: { title: '3D Visuals, Lip-Sync & Actions', cta: 'Direct 3D Scenes' },
  5: { title: 'Title & Thumbnail Expert', cta: 'Generate Packaging' },
  6: { title: '60-Day Growth Plan', cta: 'Build 60-Day Plan' },
};

function scriptToPlainText(project: StudioProject): string {
  const s = project.scriptStage;
  if (!s) return '';
  return [
    `Topic: ${s.topic}`,
    `Hook (0:00-0:10): ${s.hook10Seconds}`,
    ...s.sections.map(
      (sec, idx) =>
        `Section ${idx + 1} - ${sec.sectionTitle} (${sec.estimatedSeconds}s):\n${sec.narration}`,
    ),
    `Closing: ${s.closingCallToAction}`,
  ].join('\n\n');
}

export default function App() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>('');
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [generatingStage, setGeneratingStage] = useState<StageId | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Stage Input States (anchored cleanly across stage switches)
  const [nicheFocusNote, setNicheFocusNote] = useState('');
  const [ideasFocus, setIdeasFocus] = useState(
    'Balanced mix of imaginary parables, historical turning points, and mythological wisdom for aspirants',
  );
  const [scriptTopic, setScriptTopic] = useState('');
  const [scriptAudience, setScriptAudience] = useState(
    'Exam aspirants, students, and builders seeking resilience',
  );
  const [scriptDuration, setScriptDuration] = useState(3);
  const [scriptSource, setScriptSource] = useState('Historical Turning Point');
  const [scriptIdeaId, setScriptIdeaId] = useState<string | undefined>(undefined);

  const [visualStylePref, setVisualStylePref] = useState(
    'Obsidian Slate & Warm Amber Chiaroscuro',
  );
  const [packagingInput, setPackagingInput] = useState('');
  const [captured3DFrame, setCaptured3DFrame] = useState<string | null>(null);
  const [hoursPerDay, setHoursPerDay] = useState(2);
  const [growthBudget, setGrowthBudget] = useState('$0 (Free browser tools)');
  const [viewVault, setViewVault] = useState(false);
  const [vaultState, setVaultState] = useState<VaultStateResponse | null>(null);
  const [isStage4Exporting, setIsStage4Exporting] = useState(false);
  const [isVaultRendering, setIsVaultRendering] = useState(false);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? null,
    [projects, activeProjectId],
  );

  const syncStageInputsFromProject = useCallback((proj: StudioProject) => {
    if (proj.scriptStage) {
      setScriptTopic(proj.scriptStage.topic);
      setScriptAudience(proj.scriptStage.targetAudience);
      setScriptDuration(proj.scriptStage.durationMinutes || 3);
      setScriptIdeaId(proj.scriptStage.ideaId);
      setPackagingInput(scriptToPlainText(proj));
    } else {
      setScriptTopic('');
      setPackagingInput('');
    }
    if (proj.growthPlan) {
      setHoursPerDay(proj.growthPlan.hoursPerDay || 2);
      setGrowthBudget(proj.growthPlan.budget || '$0 (Free browser tools)');
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/projects');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load workspace');
        if (!active) return;
        const list: StudioProject[] = data.projects || [];
        setProjects(list);
        if (list[0]) {
          setActiveProjectId(list[0].id);
          syncStageInputsFromProject(list[0]);
        }
      } catch (err) {
        if (active) {
          setErrorMsg(err instanceof Error ? err.message : 'Unable to load projects');
        }
      } finally {
        if (active) setLoadingProjects(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [syncStageInputsFromProject]);

  const fetchVault = useCallback(async () => {
    try {
      const tzOffset = new Date().getTimezoneOffset();
      const res = await fetch(`/api/vault?tzOffset=${tzOffset}`);
      if (!res.ok) return;
      const data = (await res.json()) as VaultStateResponse;
      setVaultState(data);
    } catch {
      // ignore transient network check
    }
  }, []);

  const refreshProjectsSilent = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.projects)) {
        setProjects(data.projects);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchVault();
  }, [fetchVault]);

  useEffect(() => {
    if (!vaultState?.isRunning) return;
    const timer = window.setInterval(() => {
      void fetchVault();
      void refreshProjectsSilent();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [vaultState?.isRunning, fetchVault, refreshProjectsSilent]);

  const persistPatch = useCallback(
    async (projectId: string, patch: Partial<StudioProject>) => {
      // Optimistic local state update
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, ...patch, updatedAt: new Date().toISOString() }
            : p,
        ),
      );
      try {
        const res = await fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save project');
        if (data.project) {
          setProjects((prev) =>
            prev.map((p) => (p.id === projectId ? data.project : p)),
          );
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to save changes');
      }
    },
    [],
  );

  const handleSelectProject = (projectId: string) => {
    setActiveProjectId(projectId);
    const found = projects.find((p) => p.id === projectId);
    if (found) syncStageInputsFromProject(found);
  };

  const handleCreateProject = async (title: string) => {
    setErrorMsg(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create project');
      const created: StudioProject = data.project;
      setProjects((prev) => [created, ...prev]);
      setActiveProjectId(created.id);
      syncStageInputsFromProject(created);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not create project');
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete project');
      }
      setProjects((prev) => {
        const remaining = prev.filter((p) => p.id !== projectId);
        if (remaining[0]) {
          setActiveProjectId(remaining[0].id);
          syncStageInputsFromProject(remaining[0]);
        }
        return remaining;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not delete project');
    }
  };

  const handleSelectStage = (stage: StageId) => {
    setViewVault(false);
    if (!activeProject) return;
    void persistPatch(activeProject.id, { activeStage: stage });
  };

  const handleUpdateVaultSettings = async (patch: Partial<AutomationSettings>) => {
    try {
      const res = await fetch('/api/vault/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...patch,
          timezoneOffsetMinutes: new Date().getTimezoneOffset(),
        }),
      });
      if (!res.ok) throw new Error('Failed to update morning schedule');
      await fetchVault();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update morning schedule');
    }
  };

  const handleRunMorningPipeline = async (forceFresh: boolean) => {
    setErrorMsg(null);
    try {
      const res = await fetch('/api/vault/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProject?.id, forceFresh }),
      });
      if (!res.ok) throw new Error('Could not start morning pipeline');
      await fetchVault();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not start morning pipeline');
    }
  };

  const handleStopMorningPipeline = async () => {
    setErrorMsg(null);
    try {
      const res = await fetch('/api/vault/stop', { method: 'POST' });
      if (!res.ok) throw new Error('Could not stop morning pipeline');
      await fetchVault();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not stop morning pipeline');
    }
  };

  const handleDeleteVaultEpisode = async (episodeId: string) => {
    try {
      await fetch(`/api/vault/episodes/${episodeId}`, { method: 'DELETE' });
      await fetchVault();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not delete episode');
    }
  };

  const handleToggleEpisodeStatus = async (
    episodeId: string,
    nextStatus: 'ready' | 'exported',
  ) => {
    try {
      await fetch(`/api/vault/episodes/${episodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      await fetchVault();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not update episode status');
    }
  };

  const handleSaveStudioToVault = async () => {
    if (!activeProject) return;
    setErrorMsg(null);
    try {
      const res = await fetch('/api/vault/episodes/from-studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProject.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save current studio set');
      await fetchVault();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save current studio set');
    }
  };

  const handleLoadEpisodeIntoStudio = (episode: DailyEpisode) => {
    if (!activeProject) return;
    setViewVault(false);
    setScriptIdeaId(episode.idea.id);
    setScriptTopic(episode.scriptStage.topic);
    setScriptAudience(episode.scriptStage.targetAudience);
    setScriptDuration(episode.scriptStage.durationMinutes || 3);
    const updatedProj: StudioProject = {
      ...activeProject,
      activeStage: 4,
      scriptStage: episode.scriptStage,
      visualPlan: episode.visualPlan,
      packagingLab: episode.packagingLab,
    };
    setPackagingInput(scriptToPlainText(updatedProj));
    void persistPatch(activeProject.id, {
      activeStage: 4,
      scriptStage: episode.scriptStage,
      visualPlan: episode.visualPlan,
      packagingLab: episode.packagingLab,
    });
  };

  // Stage Generation Handlers
  const runStage1 = async () => {
    if (!activeProject) return;
    setErrorMsg(null);
    setGeneratingStage(1);
    try {
      const res = await fetch('/api/studio/niche', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ focusNote: nicheFocusNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stage 1 generation failed');
      await persistPatch(activeProject.id, { nicheStrategy: data.nicheStrategy });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to analyze niche');
    } finally {
      setGeneratingStage(null);
    }
  };

  const runStage2 = async () => {
    if (!activeProject) return;
    setErrorMsg(null);
    setGeneratingStage(2);
    try {
      const strategyContext = activeProject.nicheStrategy?.strongestRecommendation?.optionTitle
        ? `${ideasFocus}. Recommended angle: ${activeProject.nicheStrategy.strongestRecommendation.optionTitle}`
        : ideasFocus;
      const existingTitles = activeProject.contentIdeas.map((i) => i.title);
      const res = await fetch('/api/studio/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nicheFocus: strategyContext, existingTitles }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stage 2 generation failed');

      // Keep all shortlisted ideas and replace non-shortlisted batch with the fresh 3 ideas
      const savedShortlist = activeProject.contentIdeas.filter((i) => i.shortlisted);
      const freshBatch: ContentIdea[] = Array.isArray(data.contentIdeas) ? data.contentIdeas : [];
      const merged = [...freshBatch, ...savedShortlist].map((item, idx) => ({
        ...item,
        rankIndex: idx + 1,
      }));
      await persistPatch(activeProject.id, { contentIdeas: merged });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate 3 ideas');
    } finally {
      setGeneratingStage(null);
    }
  };

  const runStage3 = async () => {
    if (!activeProject) return;
    const topicToUse =
      scriptTopic.trim() ||
      activeProject.contentIdeas[0]?.title ||
      'The Monk Who Built a Bridge Without Iron';
    if (!scriptTopic.trim()) setScriptTopic(topicToUse);

    setErrorMsg(null);
    setGeneratingStage(3);
    try {
      const res = await fetch('/api/studio/script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ideaId: scriptIdeaId,
          topic: topicToUse,
          targetAudience: scriptAudience,
          durationMinutes: scriptDuration,
          storySource: scriptSource,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stage 3 generation failed');
      await persistPatch(activeProject.id, { scriptStage: data.scriptStage });
      const updated = { ...activeProject, scriptStage: data.scriptStage };
      setPackagingInput(scriptToPlainText(updated));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate script');
    } finally {
      setGeneratingStage(null);
    }
  };

  const runStage4 = async () => {
    if (!activeProject) return;
    const scriptText = scriptToPlainText(activeProject);
    if (!scriptText) {
      setErrorMsg('Generate a script in Stage 3 first so the 3D Director can build scenes.');
      return;
    }
    setErrorMsg(null);
    setGeneratingStage(4);
    try {
      const res = await fetch('/api/studio/visuals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scriptText,
          stylePreference: visualStylePref,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stage 4 generation failed');
      await persistPatch(activeProject.id, { visualPlan: data.visualPlan });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to direct 3D scenes');
    } finally {
      setGeneratingStage(null);
    }
  };

  const runStage5 = async () => {
    if (!activeProject) return;
    const input =
      packagingInput.trim() ||
      scriptToPlainText(activeProject) ||
      scriptTopic.trim() ||
      activeProject.contentIdeas[0]?.title ||
      '';
    if (!input) {
      setErrorMsg('Enter a topic or generate a script first.');
      return;
    }
    if (!packagingInput.trim()) setPackagingInput(input);

    setErrorMsg(null);
    setGeneratingStage(5);
    try {
      const res = await fetch('/api/studio/packaging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicOrScript: input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stage 5 generation failed');
      await persistPatch(activeProject.id, { packagingLab: data.packagingLab });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate packaging');
    } finally {
      setGeneratingStage(null);
    }
  };

  const runStage6 = async () => {
    if (!activeProject) return;
    setErrorMsg(null);
    setGeneratingStage(6);
    try {
      const res = await fetch('/api/studio/growth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hoursPerDay,
          budget: growthBudget,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Stage 6 generation failed');
      await persistPatch(activeProject.id, { growthPlan: data.growthPlan });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate 60-day growth plan');
    } finally {
      setGeneratingStage(null);
    }
  };

  const handlePrimaryAction = () => {
    if (!activeProject) return;
    switch (activeProject.activeStage) {
      case 1:
        void runStage1();
        break;
      case 2:
        void runStage2();
        break;
      case 3:
        void runStage3();
        break;
      case 4:
        void runStage4();
        break;
      case 5:
        void runStage5();
        break;
      case 6:
        void runStage6();
        break;
    }
  };

  const handleToggleShortlist = (ideaId: string) => {
    if (!activeProject) return;
    const updatedIdeas = activeProject.contentIdeas.map((idea) =>
      idea.id === ideaId ? { ...idea, shortlisted: !idea.shortlisted } : idea,
    );
    void persistPatch(activeProject.id, { contentIdeas: updatedIdeas });
  };

  const handleRemoveIdea = (ideaId: string) => {
    if (!activeProject) return;
    const updatedIdeas = activeProject.contentIdeas
      .filter((idea) => idea.id !== ideaId)
      .map((item, idx) => ({ ...item, rankIndex: idx + 1 }));
    void persistPatch(activeProject.id, { contentIdeas: updatedIdeas });
  };

  const handleSendToScript = (idea: ContentIdea) => {
    if (!activeProject) return;
    setScriptIdeaId(idea.id);
    setScriptTopic(idea.title);
    setScriptAudience(idea.targetViewer);
    void persistPatch(activeProject.id, { activeStage: 3 });
  };

  const handleUpdateScene = (sceneNumber: number, patch: Partial<SceneItem>) => {
    if (!activeProject?.visualPlan) return;
    const updatedScenes = activeProject.visualPlan.scenes.map((sc) =>
      sc.sceneNumber === sceneNumber ? { ...sc, ...patch } : sc,
    );
    void persistPatch(activeProject.id, {
      visualPlan: { ...activeProject.visualPlan, scenes: updatedScenes },
    });
  };

  const handleExportMarkdown = () => {
    if (!activeProject) return;
    const md = buildProjectMarkdown(activeProject);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeProject.title.toLowerCase().replace(/\s+/g, '-')}-production-bible.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loadingProjects || !activeProject) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0B0F19] text-slate-300">
        <div className="text-center space-y-2">
          <p className="font-display text-sm font-semibold text-amber-400">
            Storyline Director
          </p>
          <p className="text-xs text-slate-400">Loading workspace...</p>
        </div>
      </div>
    );
  }

  const stageMeta = STAGE_META[activeProject.activeStage];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0B0F19] text-slate-100">
      {/* FIXED 260px LEFT STAGE RAIL */}
      <FixedSidebar
        projects={projects}
        activeProject={activeProject}
        activeStage={activeProject.activeStage}
        isVaultActive={viewVault}
        vaultEpisodeCount={vaultState?.episodes?.length || 0}
        isPipelineRunning={Boolean(vaultState?.isRunning)}
        onSelectProject={handleSelectProject}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        onSelectStage={handleSelectStage}
        onOpenVault={() => setViewVault(true)}
        onExportMarkdown={handleExportMarkdown}
      />

      {/* FIXED RIGHT SHELL: 56px TOP BAR + LOCKED STAGE VIEWPORT */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <FixedTopBar
          projectTitle={activeProject.title}
          activeStage={activeProject.activeStage}
          stageCodeLabel={viewVault ? 'AM' : undefined}
          stageTitle={viewVault ? 'Morning Auto-Pipeline & Ready Vault' : stageMeta.title}
          primaryActionLabel={viewVault ? 'Run Morning Pipeline' : stageMeta.cta}
          isGenerating={
            viewVault
              ? Boolean(vaultState?.isRunning)
              : generatingStage === activeProject.activeStage
          }
          onPrimaryAction={() =>
            viewVault ? void handleRunMorningPipeline(false) : handlePrimaryAction()
          }
          onStopAction={
            viewVault && vaultState?.isRunning
              ? () => void handleStopMorningPipeline()
              : undefined
          }
          isStopPending={Boolean(vaultState?.cancelRequested)}
        />

        {errorMsg && (
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-red-500/30 bg-red-950/60 px-6 py-2.5 text-xs text-red-200">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              {errorMsg}
            </span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-red-300 hover:text-white"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <main className="flex min-h-0 flex-1 overflow-hidden">
          {(viewVault || isVaultRendering) && (
            <div className={viewVault ? 'flex h-full min-h-0 flex-1 overflow-hidden' : 'hidden'}>
              <DailyVaultView
                vault={vaultState}
                activeProjectId={activeProject.id}
                hasStudioEpisode={Boolean(activeProject.scriptStage && activeProject.visualPlan)}
                onRefreshVault={fetchVault}
                onUpdateSettings={handleUpdateVaultSettings}
                onRunPipeline={handleRunMorningPipeline}
                onStopPipeline={handleStopMorningPipeline}
                onSaveStudioToVault={handleSaveStudioToVault}
                onToggleEpisodeStatus={handleToggleEpisodeStatus}
                onLoadEpisodeIntoStudio={handleLoadEpisodeIntoStudio}
                onDeleteEpisode={handleDeleteVaultEpisode}
                onRenderStateChange={setIsVaultRendering}
              />
            </div>
          )}

          {!viewVault && (
            <>
              {activeProject.activeStage === 1 && (
                <Stage1Niche
                  strategy={activeProject.nicheStrategy}
                  focusNote={nicheFocusNote}
                  onChangeFocusNote={setNicheFocusNote}
                  isGenerating={generatingStage === 1}
                  onGenerate={() => void runStage1()}
                  onProceedToIdeas={() => handleSelectStage(2)}
                />
              )}

              {activeProject.activeStage === 2 && (
                <Stage2Ideas
                  ideas={activeProject.contentIdeas}
                  nicheFocus={ideasFocus}
                  onChangeNicheFocus={setIdeasFocus}
                  isGenerating={generatingStage === 2}
                  onGenerate={() => void runStage2()}
                  onToggleShortlist={handleToggleShortlist}
                  onRemoveIdea={handleRemoveIdea}
                  onSendToScript={handleSendToScript}
                />
              )}

              {activeProject.activeStage === 3 && (
                <Stage3Script
                  ideas={activeProject.contentIdeas}
                  script={activeProject.scriptStage}
                  topic={scriptTopic}
                  targetAudience={scriptAudience}
                  durationMinutes={scriptDuration}
                  storySource={scriptSource}
                  onChangeTopic={setScriptTopic}
                  onChangeTargetAudience={setScriptAudience}
                  onChangeDurationMinutes={setScriptDuration}
                  onChangeStorySource={setScriptSource}
                  isGenerating={generatingStage === 3}
                  onGenerate={() => void runStage3()}
                  onSendToVisuals={() => handleSelectStage(4)}
                  onSendToPackaging={() => {
                    setPackagingInput(scriptToPlainText(activeProject));
                    handleSelectStage(5);
                  }}
                />
              )}

              {activeProject.activeStage === 5 && (
                <Stage5Packaging
                  packaging={activeProject.packagingLab}
                  topicOrScriptInput={packagingInput}
                  onChangeTopicOrScriptInput={setPackagingInput}
                  captured3DFrame={captured3DFrame}
                  isGenerating={generatingStage === 5}
                  onGenerate={() => void runStage5()}
                />
              )}

              {activeProject.activeStage === 6 && (
                <Stage6Growth
                  growthPlan={activeProject.growthPlan}
                  hoursPerDay={hoursPerDay}
                  budget={growthBudget}
                  onChangeHoursPerDay={setHoursPerDay}
                  onChangeBudget={setGrowthBudget}
                  isGenerating={generatingStage === 6}
                  onGenerate={() => void runStage6()}
                />
              )}
            </>
          )}

          {((!viewVault && activeProject.activeStage === 4) || isStage4Exporting) && (
            <div
              className={
                !viewVault && activeProject.activeStage === 4
                  ? 'flex h-full min-h-0 flex-1 overflow-hidden'
                  : 'hidden'
              }
            >
              <Stage4Visuals3D
                visualPlan={activeProject.visualPlan}
                hasScript={Boolean(activeProject.scriptStage)}
                stylePreference={visualStylePref}
                onChangeStylePreference={setVisualStylePref}
                isGenerating={generatingStage === 4}
                onGenerate={() => void runStage4()}
                onUpdateScene={handleUpdateScene}
                onSaveCapturedFrame={(url) => setCaptured3DFrame(url)}
                onExportStateChange={setIsStage4Exporting}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
