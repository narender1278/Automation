import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  AutomationSettings,
  ContentIdea,
  DailyEpisode,
  PackagingData,
  ScriptData,
  StageId,
  StudioProject,
  VisualPlan,
} from './src/types/studio.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(apiVersion?: string) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in Settings > Secrets.');
  }
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)?.trim();
  if (!url || !key || url === 'MY_SUPABASE_URL' || key.startsWith('MY_SUPABASE_')) {
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const LOCAL_STORE_PATH = path.resolve(__dirname, '.studio-projects.json');
const LOCAL_VAULT_PATH = path.resolve(__dirname, '.studio-vault.json');
const AUDIO_CACHE_DIR = path.resolve(__dirname, '.studio-audio');

const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  enabled: true,
  morningTime: '07:00',
  dailyCount: 1,
  onlyIfIdeasEmpty: true,
  autoShortlistAll: true,
  timezoneOffsetMinutes: 0,
  lastRunDate: null,
  lastRunSummary: null,
};

interface VaultStoreData {
  settings: AutomationSettings;
  episodes: DailyEpisode[];
}

function readLocalProjects(): StudioProject[] {
  try {
    if (!fs.existsSync(LOCAL_STORE_PATH)) return [];
    const raw = fs.readFileSync(LOCAL_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalProjects(projects: StudioProject[]): void {
  fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(projects, null, 2), 'utf8');
}

function readLocalVault(): VaultStoreData {
  try {
    if (!fs.existsSync(LOCAL_VAULT_PATH)) {
      return { settings: { ...DEFAULT_AUTOMATION_SETTINGS }, episodes: [] };
    }
    const raw = fs.readFileSync(LOCAL_VAULT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      settings: { ...DEFAULT_AUTOMATION_SETTINGS, ...(parsed?.settings || {}) },
      episodes: Array.isArray(parsed?.episodes) ? parsed.episodes : [],
    };
  } catch {
    return { settings: { ...DEFAULT_AUTOMATION_SETTINGS }, episodes: [] };
  }
}

function writeLocalVault(vault: VaultStoreData): void {
  fs.writeFileSync(LOCAL_VAULT_PATH, JSON.stringify(vault, null, 2), 'utf8');
}

async function readVault(): Promise<VaultStoreData> {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('studio_vault')
        .select('*')
        .eq('id', 'default')
        .maybeSingle();
      if (!error && data) {
        return {
          settings: { ...DEFAULT_AUTOMATION_SETTINGS, ...(data.settings || {}) },
          episodes: Array.isArray(data.episodes) ? (data.episodes as DailyEpisode[]) : [],
        };
      }
      if (!error && !data) {
        const local = readLocalVault();
        await supabase.from('studio_vault').upsert({
          id: 'default',
          settings: local.settings,
          episodes: local.episodes,
          updated_at: new Date().toISOString(),
        });
        return local;
      }
    } catch {
      // Fall back silently if studio_vault table hasn't been created in Supabase yet
    }
  }
  return readLocalVault();
}

async function writeVault(vault: VaultStoreData): Promise<void> {
  writeLocalVault(vault);
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('studio_vault').upsert({
        id: 'default',
        settings: vault.settings,
        episodes: vault.episodes,
        updated_at: new Date().toISOString(),
      });
    } catch {
      // Local vault JSON remains intact even if optional studio_vault table isn't migrated yet
    }
  }
}

function getEpisodeAudioPath(episodeId: string, sceneNumber: number): string {
  const safeId = episodeId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(AUDIO_CACHE_DIR, safeId, `scene-${Number(sceneNumber)}.wav`);
}

function saveEpisodeAudioFile(episodeId: string, sceneNumber: number, base64Data: string): void {
  const filePath = getEpisodeAudioPath(episodeId, sceneNumber);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
}

function deleteEpisodeAudioDir(episodeId: string): void {
  const safeId = episodeId.replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.join(AUDIO_CACHE_DIR, safeId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function getUserLocalDateTime(offsetMinutes = 0): { dateStr: string; hhmm: string } {
  // Date.getTimezoneOffset() returns minutes behind UTC (e.g. UTC+5:30 => -330, PST UTC-8 => +480)
  const localMs = Date.now() - offsetMinutes * 60_000;
  const d = new Date(localMs);
  const dateStr = d.toISOString().slice(0, 10);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return { dateStr, hhmm: `${hh}:${mm}` };
}

interface SupabaseProjectRow {
  id: string;
  title: string;
  active_stage: number;
  niche_strategy: StudioProject['nicheStrategy'];
  content_ideas: StudioProject['contentIdeas'];
  script_stage: StudioProject['scriptStage'];
  visual_plan: StudioProject['visualPlan'];
  packaging_lab: StudioProject['packagingLab'];
  growth_plan: StudioProject['growthPlan'];
  created_at: string;
  updated_at: string;
}

function rowToProject(row: SupabaseProjectRow): StudioProject {
  return {
    id: row.id,
    title: row.title,
    activeStage: (row.active_stage || 1) as StageId,
    nicheStrategy: row.niche_strategy ?? null,
    contentIdeas: Array.isArray(row.content_ideas) ? row.content_ideas : [],
    scriptStage: row.script_stage ?? null,
    visualPlan: row.visual_plan ?? null,
    packagingLab: row.packaging_lab ?? null,
    growthPlan: row.growth_plan ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function projectToRow(project: Partial<StudioProject>) {
  const payload: Record<string, unknown> = {};
  if (project.title !== undefined) payload.title = project.title;
  if (project.activeStage !== undefined) payload.active_stage = project.activeStage;
  if (project.nicheStrategy !== undefined) payload.niche_strategy = project.nicheStrategy;
  if (project.contentIdeas !== undefined) payload.content_ideas = project.contentIdeas;
  if (project.scriptStage !== undefined) payload.script_stage = project.scriptStage;
  if (project.visualPlan !== undefined) payload.visual_plan = project.visualPlan;
  if (project.packagingLab !== undefined) payload.packaging_lab = project.packagingLab;
  if (project.growthPlan !== undefined) payload.growth_plan = project.growthPlan;
  payload.updated_at = new Date().toISOString();
  return payload;
}

function createEmptyProject(title = 'Motivational Stories Channel'): StudioProject {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    activeStage: 1,
    nicheStrategy: null,
    contentIdeas: [],
    scriptStage: null,
    visualPlan: null,
    packagingLab: null,
    growthPlan: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function listProjects(): Promise<{ projects: StudioProject[]; provider: 'supabase' | 'local' }> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from('studio_projects')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }
    if (!data || data.length === 0) {
      const starter = createEmptyProject('Motivational Stories Channel');
      const { data: inserted, error: insertErr } = await supabase
        .from('studio_projects')
        .insert({
          id: starter.id,
          title: starter.title,
          active_stage: starter.activeStage,
          content_ideas: [],
        })
        .select('*')
        .single();
      if (insertErr) throw new Error(`Supabase insert error: ${insertErr.message}`);
      return { projects: [rowToProject(inserted as SupabaseProjectRow)], provider: 'supabase' };
    }
    return { projects: (data as SupabaseProjectRow[]).map(rowToProject), provider: 'supabase' };
  }

  let local = readLocalProjects();
  if (local.length === 0) {
    local = [createEmptyProject('Motivational Stories Channel')];
    writeLocalProjects(local);
  }
  return { projects: local, provider: 'local' };
}

async function createProject(title: string): Promise<StudioProject> {
  const project = createEmptyProject(title.trim() || 'Untitled Channel Launch');
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from('studio_projects')
      .insert({
        id: project.id,
        title: project.title,
        active_stage: 1,
        content_ideas: [],
      })
      .select('*')
      .single();
    if (error) throw new Error(`Supabase error: ${error.message}`);
    return rowToProject(data as SupabaseProjectRow);
  }
  const local = readLocalProjects();
  local.unshift(project);
  writeLocalProjects(local);
  return project;
}

async function updateProject(id: string, patch: Partial<StudioProject>): Promise<StudioProject> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from('studio_projects')
      .update(projectToRow(patch))
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(`Supabase error: ${error.message}`);
    return rowToProject(data as SupabaseProjectRow);
  }

  const local = readLocalProjects();
  const idx = local.findIndex((p) => p.id === id);
  if (idx === -1) {
    throw new Error('Project not found');
  }
  const updated: StudioProject = {
    ...local[idx],
    ...patch,
    id: local[idx].id,
    updatedAt: new Date().toISOString(),
  };
  local[idx] = updated;
  writeLocalProjects(local);
  return updated;
}

async function deleteProject(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { error } = await supabase.from('studio_projects').delete().eq('id', id);
    if (error) throw new Error(`Supabase error: ${error.message}`);
    return;
  }
  const local = readLocalProjects().filter((p) => p.id !== id);
  writeLocalProjects(local);
}

const LOCKED_NICHE_DESCRIPTION =
  'Motivating people and aspirants by telling short stories—both imaginary, mythological, and historical.';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Project CRUD endpoints (Supabase PostgreSQL when configured, local fallback otherwise)
  app.get('/api/projects', async (_req, res) => {
    try {
      const result = await listProjects();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load projects' });
    }
  });

  app.post('/api/projects', async (req, res) => {
    try {
      const title = typeof req.body?.title === 'string' ? req.body.title : 'Untitled Channel Launch';
      const project = await createProject(title);
      res.status(201).json({ project });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create project' });
    }
  });

  app.patch('/api/projects/:id', async (req, res) => {
    try {
      const project = await updateProject(req.params.id, req.body || {});
      res.json({ project });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update project' });
    }
  });

  app.delete('/api/projects/:id', async (req, res) => {
    try {
      await deleteProject(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete project' });
    }
  });

  // STAGE 1: THE PROFITABLE NICHE
  app.post('/api/studio/niche', async (req, res) => {
    try {
      const ai = getAiClient();
      const focusNote = typeof req.body?.focusNote === 'string' ? req.body.focusNote.trim() : '';
      const prompt = `Act as a YouTube strategist.
My niche is strictly locked to: "${LOCKED_NICHE_DESCRIPTION}"
${focusNote ? `Creator emphasis note: ${focusNote}` : ''}

Explain in full depth:
1. Its audience (distinct aspirant segments, mindset, and core emotional/practical desires).
2. Content opportunities (how imaginary, historical, and mythological short stories each unlock distinct pillars).
3. Challenges (production, retention, saturation, copyright/factual accuracy) and practical mitigations.
4. Monetization methods suitable for this storytelling channel.
5. Rank the strategic sub-niche/monetization options from strongest to weakest and recommend the single strongest path.

CRITICAL RULE: Do NOT invent or fabricate any statistics, percentages, RPM dollar numbers, or fake view counts. Use qualitative, verifiable reasoning only.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'You are a senior YouTube strategist specializing in motivational storytelling channels. Never invent statistics, percentages, or fake metrics.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              nicheSummary: { type: Type.STRING },
              audienceBreakdown: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    segment: { type: Type.STRING },
                    mindset: { type: Type.STRING },
                    coreDesire: { type: Type.STRING },
                  },
                  required: ['segment', 'mindset', 'coreDesire'],
                },
              },
              contentOpportunities: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    pillar: { type: Type.STRING },
                    storySource: { type: Type.STRING },
                    angle: { type: Type.STRING },
                  },
                  required: ['pillar', 'storySource', 'angle'],
                },
              },
              challenges: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    challenge: { type: Type.STRING },
                    mitigation: { type: Type.STRING },
                  },
                  required: ['challenge', 'mitigation'],
                },
              },
              monetizationMethods: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    method: { type: Type.STRING },
                    description: { type: Type.STRING },
                    readinessStage: { type: Type.STRING },
                  },
                  required: ['method', 'description', 'readinessStage'],
                },
              },
              rankedOptions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    rank: { type: Type.INTEGER },
                    title: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    effortLevel: { type: Type.STRING },
                    monetizationFit: { type: Type.STRING },
                    whyRanked: { type: Type.STRING },
                  },
                  required: ['rank', 'title', 'summary', 'effortLevel', 'monetizationFit', 'whyRanked'],
                },
              },
              strongestRecommendation: {
                type: Type.OBJECT,
                properties: {
                  optionTitle: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                  firstStepFocus: { type: Type.STRING },
                },
                required: ['optionTitle', 'rationale', 'firstStepFocus'],
              },
            },
            required: [
              'nicheSummary',
              'audienceBreakdown',
              'contentOpportunities',
              'challenges',
              'monetizationMethods',
              'rankedOptions',
              'strongestRecommendation',
            ],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      res.json({ nicheStrategy: parsed });
    } catch (error) {
      console.error('Stage 1 Niche error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate niche strategy' });
    }
  });

  // Shared Free-Tier Gemini Studio Generators
  async function generateIdeasBatch(
    ai: GoogleGenAI,
    nicheFocus: string,
    existingTitles: string[],
    count: number,
  ): Promise<ContentIdea[]> {
    const safeCount = Math.max(1, Math.min(5, count));
    const exclusionBlock =
      existingTitles.length > 0
        ? `\nDo NOT repeat or closely paraphrase any of these previously generated titles:\n- ${existingTitles.slice(0, 60).join('\n- ')}`
        : '';

    const prompt = `Act as a YouTube content strategist.
The creator posts motivational story videos and wants a focused batch of ${safeCount} high-conviction video ideas at a time.
Generate exactly ${safeCount} distinct video ideas for my channel in the locked niche: "${LOCKED_NICHE_DESCRIPTION}".
Strategic focus: ${nicheFocus}.
${exclusionBlock}

Requirements:
- Return exactly ${safeCount} distinct ideas numbered rankIndex 1 through ${safeCount}.
- Vary the ideas across different story sources (imaginary parable, historical turning point, mythological wisdom) and categories ("Evergreen", "Trending", "Educational", "Storytelling").
- Each idea MUST include: compelling title, centralTopic, targetViewer, recommendedFormat, category (must be one of: "Evergreen", "Trending", "Educational", "Storytelling"), and reasonPeopleWatch.
- Avoid generic clichés ("Top 5 habits", "Never give up") and strictly avoid misleading clickbait.`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          `You are a YouTube content strategist for a motivational storytelling channel. Generate exactly ${safeCount} distinct, non-generic, non-clickbait video ideas per batch.`,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            ideas: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  rankIndex: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  centralTopic: { type: Type.STRING },
                  targetViewer: { type: Type.STRING },
                  recommendedFormat: { type: Type.STRING },
                  category: {
                    type: Type.STRING,
                    enum: ['Evergreen', 'Trending', 'Educational', 'Storytelling'],
                  },
                  reasonPeopleWatch: { type: Type.STRING },
                },
                required: [
                  'id',
                  'rankIndex',
                  'title',
                  'centralTopic',
                  'targetViewer',
                  'recommendedFormat',
                  'category',
                  'reasonPeopleWatch',
                ],
              },
            },
          },
          required: ['ideas'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{"ideas":[]}');
    return (Array.isArray(parsed.ideas) ? parsed.ideas : [])
      .slice(0, safeCount)
      .map((idea: Record<string, unknown>, i: number) => ({
        ...(idea as unknown as ContentIdea),
        id: crypto.randomUUID(),
        rankIndex: i + 1,
        shortlisted: false,
      }));
  }

  async function generateScriptData(
    ai: GoogleGenAI,
    params: {
      ideaId?: string;
      topic: string;
      targetAudience: string;
      durationMinutes: number;
      storySource: string;
    },
  ): Promise<ScriptData> {
    const prompt = `Act as a professional YouTube scriptwriter for the locked niche: "${LOCKED_NICHE_DESCRIPTION}".
Write a ${params.durationMinutes}-minute faceless video script about: "${params.topic}"
Story source style: ${params.storySource}
Target audience: ${params.targetAudience}

Requirements:
- Start with a powerful 10-second hook that opens an immediate curiosity loop without clickbait.
- Build curiosity through vivid storytelling, clear structural sections, concrete examples, and smooth transitions.
- Include explicit pattern interrupts inside each section to retain viewer attention.
- Use natural spoken language ready for voiceover narration.
- Strictly remove filler, repetition, and unsupported factual or statistical claims (if telling an imaginary parable, frame it honestly as a parable; if historical/mythological, stick to well-established narrative beats).`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a master faceless YouTube scriptwriter for motivational short stories. Write crisp, natural spoken narration with zero fluff or unsupported claims.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            topic: { type: Type.STRING },
            targetAudience: { type: Type.STRING },
            durationMinutes: { type: Type.NUMBER },
            hook10Seconds: { type: Type.STRING },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sectionTitle: { type: Type.STRING },
                  estimatedSeconds: { type: Type.INTEGER },
                  narration: { type: Type.STRING },
                  patternInterrupt: { type: Type.STRING },
                  transitionLine: { type: Type.STRING },
                },
                required: ['sectionTitle', 'estimatedSeconds', 'narration', 'patternInterrupt', 'transitionLine'],
              },
            },
            closingCallToAction: { type: Type.STRING },
            estimatedWordCount: { type: Type.INTEGER },
          },
          required: [
            'topic',
            'targetAudience',
            'durationMinutes',
            'hook10Seconds',
            'sections',
            'closingCallToAction',
            'estimatedWordCount',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return { ...parsed, ideaId: params.ideaId } as ScriptData;
  }

  async function generateVisualsData(
    ai: GoogleGenAI,
    scriptText: string,
    stylePreference: string,
  ): Promise<VisualPlan> {
    const prompt = `Act as a video creative director and 3D stage choreographer for a motivational storytelling channel ("${LOCKED_NICHE_DESCRIPTION}").
Turn the following script into a cohesive, scene-by-scene production plan (6 to 8 scenes).
Visual direction baseline: ${stylePreference}

Script:
${scriptText}

For each scene, provide:
- sceneNumber (1..N)
- title (short scene beat label)
- narrationCue (exact spoken sentences from the script for that scene, ready for voiceover lip-sync)
- visualDescription (how the scene looks and supports the narration)
- imagePrompt (detailed, style-consistent AI image prompt)
- videoPrompt (motion/camera instruction if animation or video motion is needed)
- brollSuggestion (supporting B-roll clip idea)
- onScreenText (concise high-impact text overlay, max 6 words)
- durationSeconds (integer seconds)
- action (choose the best fit from: "idle_breath", "storyteller_gesture", "emphasize_point", "heroic_stance", "reflective_nod", "dramatic_lean")
- storyActivity (physical 3D multi-figure enactment summary, choose from: "crossroads_meeting", "mentorship_dialogue", "orator_walk", "forge_labor", "climb_ascent", "scholar_study", "duel_overcome", "triumph_raise")
- directorBlocks (REQUIRED array of 2 to 4 chronological physical choreography beats spanning startPct=0 to endPct=100 that act out this exact scene's story! Each beat moves, faces, sits, talks, nods, shakes hands, strikes anvil, climbs, waves, or leaves as the script describes:
  * startPct, endPct (numbers 0..100, contiguous e.g. 0-30, 30-60, 60-85, 85-100)
  * heroX, heroZ (3D coordinates: X in -4.8..4.8, Z in -3.0..2.5; when sitting on crossroads_cafe use chair coords left=(2.96,-2.55) or right=(4.24,-2.55); on other stageSets use left=(-0.64,-0.35) or right=(0.64,-0.35))
  * heroPosture ("walk" | "stand" | "sit_left" | "sit_right")
  * heroGesture ("talk" | "listen_nod" | "shake_hands" | "wave_bye" | "hammer_strike" | "raise_torch" | "read_scroll" | "duel_guard" | "celebrate")
  * compX, compZ (companion 3D coordinates -4.8..4.8, -3.0..2.5; keep >= 0.7m apart from hero unless shaking hands)
  * compPosture ("walk" | "stand" | "sit_left" | "sit_right")
  * compGesture ("talk" | "listen_nod" | "shake_hands" | "wave_bye" | "hammer_strike" | "raise_torch" | "read_scroll" | "duel_guard" | "celebrate")
  * faceMode ("each_other" | "camera" | "path" | "table")
  * cameraShot ("wide_establishing" | "two_shot" | "table_dialogue" | "closeup_hero" | "low_hero" | "track_motion"))
- cameraPreset (choose the best fit from: "wide_stage", "medium_shot", "closeup_lipsync", "low_hero")
- lightingMood (choose the best fit from: "warm_dawn", "torchlit_mythic", "obsidian_studio")
- stageSet (choose the best fit from: "crossroads_cafe" for street meetings/conversations/table talks/partings, "philosopher_pillar" for classic speeches/duels/forges, "summit_overlook" for mountain climbs/victories, "ancient_archive" for study/wisdom/scrolls)
- voiceName ("Charon" by default, or "Fenrir" / "Kore")
- lipSyncIntensity (number between 0.8 and 1.35)

IMPORTANT: Write vivid, non-static directorBlocks for EVERY scene so the 3D characters physically walk across the set, turn toward each other, sit down cleanly when a table/chair fits the story, gesture while talking, nod, shake hands, wave bye, or work props exactly matching narrationCue and visualDescription!`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a video creative director and 3D stage choreographer. Ensure visual consistency and tight spatial blocking in directorBlocks so characters physically act out every script beat.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            styleBible: {
              type: Type.OBJECT,
              properties: {
                colorPalette: { type: Type.STRING },
                lightingDirection: { type: Type.STRING },
                visualStyle: { type: Type.STRING },
                cameraLanguage: { type: Type.STRING },
              },
              required: ['colorPalette', 'lightingDirection', 'visualStyle', 'cameraLanguage'],
            },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sceneNumber: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  narrationCue: { type: Type.STRING },
                  visualDescription: { type: Type.STRING },
                  imagePrompt: { type: Type.STRING },
                  videoPrompt: { type: Type.STRING },
                  brollSuggestion: { type: Type.STRING },
                  onScreenText: { type: Type.STRING },
                  durationSeconds: { type: Type.INTEGER },
                  action: {
                    type: Type.STRING,
                    enum: [
                      'idle_breath',
                      'storyteller_gesture',
                      'emphasize_point',
                      'heroic_stance',
                      'reflective_nod',
                      'dramatic_lean',
                    ],
                  },
                  storyActivity: {
                    type: Type.STRING,
                    enum: [
                      'orator_walk',
                      'forge_labor',
                      'climb_ascent',
                      'scholar_study',
                      'duel_overcome',
                      'triumph_raise',
                      'crossroads_meeting',
                      'mentorship_dialogue',
                    ],
                  },
                  directorBlocks: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        startPct: { type: Type.NUMBER },
                        endPct: { type: Type.NUMBER },
                        heroX: { type: Type.NUMBER },
                        heroZ: { type: Type.NUMBER },
                        heroPosture: {
                          type: Type.STRING,
                          enum: ['walk', 'stand', 'sit_left', 'sit_right'],
                        },
                        heroGesture: {
                          type: Type.STRING,
                          enum: [
                            'talk',
                            'listen_nod',
                            'shake_hands',
                            'wave_bye',
                            'hammer_strike',
                            'raise_torch',
                            'read_scroll',
                            'duel_guard',
                            'celebrate',
                          ],
                        },
                        compX: { type: Type.NUMBER },
                        compZ: { type: Type.NUMBER },
                        compPosture: {
                          type: Type.STRING,
                          enum: ['walk', 'stand', 'sit_left', 'sit_right'],
                        },
                        compGesture: {
                          type: Type.STRING,
                          enum: [
                            'talk',
                            'listen_nod',
                            'shake_hands',
                            'wave_bye',
                            'hammer_strike',
                            'raise_torch',
                            'read_scroll',
                            'duel_guard',
                            'celebrate',
                          ],
                        },
                        faceMode: {
                          type: Type.STRING,
                          enum: ['each_other', 'camera', 'path', 'table'],
                        },
                        cameraShot: {
                          type: Type.STRING,
                          enum: [
                            'wide_establishing',
                            'two_shot',
                            'table_dialogue',
                            'closeup_hero',
                            'low_hero',
                            'track_motion',
                          ],
                        },
                      },
                      required: [
                        'startPct',
                        'endPct',
                        'heroX',
                        'heroZ',
                        'heroPosture',
                        'heroGesture',
                        'compX',
                        'compZ',
                        'compPosture',
                        'compGesture',
                        'faceMode',
                        'cameraShot',
                      ],
                    },
                  },
                  cameraPreset: {
                    type: Type.STRING,
                    enum: ['wide_stage', 'medium_shot', 'closeup_lipsync', 'low_hero'],
                  },
                  lightingMood: {
                    type: Type.STRING,
                    enum: ['warm_dawn', 'torchlit_mythic', 'obsidian_studio'],
                  },
                  stageSet: {
                    type: Type.STRING,
                    enum: [
                      'philosopher_pillar',
                      'summit_overlook',
                      'ancient_archive',
                      'crossroads_cafe',
                    ],
                  },
                  voiceName: {
                    type: Type.STRING,
                    enum: ['Charon', 'Kore', 'Fenrir', 'Puck', 'Zephyr'],
                  },
                  lipSyncIntensity: { type: Type.NUMBER },
                },
                required: [
                  'sceneNumber',
                  'title',
                  'narrationCue',
                  'visualDescription',
                  'imagePrompt',
                  'videoPrompt',
                  'brollSuggestion',
                  'onScreenText',
                  'durationSeconds',
                  'action',
                  'storyActivity',
                  'directorBlocks',
                  'cameraPreset',
                  'lightingMood',
                  'stageSet',
                  'voiceName',
                  'lipSyncIntensity',
                ],
              },
            },
          },
          required: ['styleBible', 'scenes'],
        },
      },
    });

    return JSON.parse(response.text || '{}') as VisualPlan;
  }

  async function synthesizeWavBase64(
    _ai: GoogleGenAI,
    text: string,
    voiceName = 'Charon',
  ): Promise<{ audioBase64: string; mimeType: string }> {
    const ttsAi = getAiClient('v1beta');
    const response = await ttsAi.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text,
              speechMetadata: {
                style: 'Warm, cinematic motivational storyteller with measured dramatic pauses',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const audioPart = parts.find((p) => p.inlineData?.data);
    if (!audioPart?.inlineData?.data) {
      throw new Error('TTS model returned no audio data.');
    }
    return {
      audioBase64: audioPart.inlineData.data,
      mimeType: audioPart.inlineData.mimeType || 'audio/wav',
    };
  }

  async function generatePackagingData(
    ai: GoogleGenAI,
    topicOrScript: string,
    chapterHints = '',
  ): Promise<PackagingData> {
    const prompt = `Act as a YouTube packaging expert for the locked niche: "${LOCKED_NICHE_DESCRIPTION}".
Analyze this topic/script and create:
1. 10 clickable, honest titles (no misleading titles or exaggerated promises).
2. 5 thumbnail concepts. For each thumbnail describe: subject, background, composition, colors (array of 2-3 hex color codes like "#F59E0B"), shortText (2-4 bold words max), and curiosityBehindPairing.
3. Rank the strongest 3 title + thumbnail combinations and explain why they trigger authentic curiosity.
4. A complete upload-ready YouTube video description ("youtubeDescription") featuring: an opening 2-line curiosity hook, a concise story lesson summary, chapter timestamps${chapterHints ? ` based on these scenes:\n${chapterHints}` : ''}, a respectful subscribe reflection prompt, and 3-5 clean hashtags.
5. An array of 10 relevant YouTube search tags ("youtubeTags").

Topic / Script input:
${topicOrScript}`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a YouTube packaging expert. Avoid clickbait, exaggerated guarantees, and misleading claims.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            analyzedTopic: { type: Type.STRING },
            youtubeDescription: { type: Type.STRING },
            youtubeTags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            titles: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  rank: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  angle: { type: Type.STRING },
                  curiosityMechanism: { type: Type.STRING },
                },
                required: ['rank', 'title', 'angle', 'curiosityMechanism'],
              },
            },
            thumbnails: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  conceptName: { type: Type.STRING },
                  subject: { type: Type.STRING },
                  background: { type: Type.STRING },
                  composition: { type: Type.STRING },
                  colors: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  shortText: { type: Type.STRING },
                  curiosityBehindPairing: { type: Type.STRING },
                },
                required: [
                  'id',
                  'conceptName',
                  'subject',
                  'background',
                  'composition',
                  'colors',
                  'shortText',
                  'curiosityBehindPairing',
                ],
              },
            },
            topThree: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  rank: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  thumbnailConceptName: { type: Type.STRING },
                  whyStrongest: { type: Type.STRING },
                },
                required: ['rank', 'title', 'thumbnailConceptName', 'whyStrongest'],
              },
            },
          },
          required: ['analyzedTopic', 'youtubeDescription', 'youtubeTags', 'titles', 'thumbnails', 'topThree'],
        },
      },
    });

    return JSON.parse(response.text || '{}') as PackagingData;
  }

  // STAGE 2: THE CONTENT IDEA GENERATOR (3 Ideas per batch for manual review)
  app.post('/api/studio/ideas', async (req, res) => {
    try {
      const ai = getAiClient();
      const nicheFocus =
        typeof req.body?.nicheFocus === 'string' && req.body.nicheFocus.trim()
          ? req.body.nicheFocus.trim()
          : 'Balanced mix of imaginary, mythological, and historical motivational short stories for aspirants';
      const existingTitles = Array.isArray(req.body?.existingTitles)
        ? req.body.existingTitles.filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
        : [];
      const count = typeof req.body?.count === 'number' ? req.body.count : 3;

      const ideas = await generateIdeasBatch(ai, nicheFocus, existingTitles, count);
      res.json({ contentIdeas: ideas });
    } catch (error) {
      console.error('Stage 2 Ideas error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate ideas' });
    }
  });

  // STAGE 3: THE SCRIPT GENERATOR
  app.post('/api/studio/script', async (req, res) => {
    try {
      const ai = getAiClient();
      const topic = typeof req.body?.topic === 'string' ? req.body.topic.trim() : '';
      const targetAudience =
        typeof req.body?.targetAudience === 'string' && req.body.targetAudience.trim()
          ? req.body.targetAudience.trim()
          : 'Ambitious students, exam aspirants, and early-career builders seeking resilience';
      const durationMinutes = Number(req.body?.durationMinutes) || 3;
      const storySource =
        typeof req.body?.storySource === 'string' && req.body.storySource.trim()
          ? req.body.storySource.trim()
          : 'Historical or Mythological Motivational Story';

      if (!topic) {
        return res.status(400).json({ error: 'Please enter or select a topic first.' });
      }

      const scriptStage = await generateScriptData(ai, {
        ideaId: req.body?.ideaId,
        topic,
        targetAudience,
        durationMinutes,
        storySource,
      });
      res.json({ scriptStage });
    } catch (error) {
      console.error('Stage 3 Script error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate script' });
    }
  });

  // STAGE 4: THE 3D VISUAL & SCENE DIRECTOR
  app.post('/api/studio/visuals', async (req, res) => {
    try {
      const ai = getAiClient();
      const scriptText = typeof req.body?.scriptText === 'string' ? req.body.scriptText.trim() : '';
      const stylePreference =
        typeof req.body?.stylePreference === 'string' && req.body.stylePreference.trim()
          ? req.body.stylePreference.trim()
          : 'Obsidian Slate & Warm Amber Chiaroscuro';

      if (!scriptText) {
        return res.status(400).json({ error: 'Please generate or paste a script first.' });
      }

      const visualPlan = await generateVisualsData(ai, scriptText, stylePreference);
      res.json({ visualPlan });
    } catch (error) {
      console.error('Stage 4 Visuals error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate 3D scene plan' });
    }
  });

  // STAGE 4 AUDIO: Gemini TTS Synthesis for real-time 3D Lip-Sync
  app.post('/api/studio/tts', async (req, res) => {
    try {
      const ai = getAiClient();
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const voiceName = typeof req.body?.voiceName === 'string' ? req.body.voiceName : 'Charon';

      if (!text) {
        return res.status(400).json({ error: 'Narration text is required for voice synthesis.' });
      }

      const result = await synthesizeWavBase64(ai, text, voiceName);
      res.json(result);
    } catch (error) {
      console.error('TTS synthesis error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to synthesize voiceover' });
    }
  });

  // VIDEO TRANSCODE ENDPOINT (WebM -> Universal MP4 / MKV via ffmpeg)
  const execFileAsync = promisify(execFile);
  app.post(
    '/api/studio/convert-video',
    express.raw({ type: '*/*', limit: '250mb' }),
    async (req, res) => {
      const format = req.query.format === 'mkv' ? 'mkv' : 'mp4';
      const inputBuf = Buffer.isBuffer(req.body) ? req.body : null;
      if (!inputBuf || inputBuf.length === 0) {
        return res.status(400).json({ error: 'Empty video payload.' });
      }
      const workId = crypto.randomUUID();
      const tmpIn = path.join(os.tmpdir(), `storyline-${workId}.webm`);
      const tmpOut = path.join(os.tmpdir(), `storyline-${workId}.${format}`);
      try {
        await fs.promises.writeFile(tmpIn, inputBuf);
        const args =
          format === 'mkv'
            ? [
                '-y',
                '-i',
                tmpIn,
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-crf',
                '21',
                '-pix_fmt',
                'yuv420p',
                '-c:a',
                'aac',
                '-b:a',
                '160k',
                tmpOut,
              ]
            : [
                '-y',
                '-i',
                tmpIn,
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-crf',
                '21',
                '-pix_fmt',
                'yuv420p',
                '-c:a',
                'aac',
                '-b:a',
                '160k',
                '-movflags',
                '+faststart',
                tmpOut,
              ];
        await execFileAsync('ffmpeg', args, { timeout: 120_000 });
        const outBuf = await fs.promises.readFile(tmpOut);
        res.setHeader(
          'Content-Type',
          format === 'mkv' ? 'video/x-matroska' : 'video/mp4',
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="storyline-video.${format}"`,
        );
        res.send(outBuf);
      } catch (err) {
        console.error('FFmpeg convert error:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to convert video format.',
        });
      } finally {
        fs.promises.unlink(tmpIn).catch(() => {});
        fs.promises.unlink(tmpOut).catch(() => {});
      }
    },
  );

  // DETERMINISTIC OFFLINE SCENE RENDER (Binary JPEG frames + WAV -> exact A/V locked MP4)
  app.post(
    '/api/studio/render-scene',
    express.raw({ type: 'application/octet-stream', limit: '250mb' }),
    async (req, res) => {
      const rawJobId = String(req.query.jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const sceneIndex = Math.max(0, Math.min(999, Number(req.query.sceneIndex) || 0));
      const fps = Math.max(12, Math.min(60, Number(req.query.fps) || 24));
      const returnClip = req.query.returnClip === '1';
      const returnFormat =
        req.query.format === 'mkv' ? 'mkv' : req.query.format === 'webm' ? 'webm' : 'mp4';

      const buf = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buf || buf.length < 8) {
        return res.status(400).json({ error: 'Invalid render frame pack.' });
      }

      const jobDir = path.join(os.tmpdir(), 'storyline-renders', rawJobId || crypto.randomUUID());
      const framesDir = path.join(jobDir, `frames_${String(sceneIndex).padStart(3, '0')}`);

      try {
        await fs.promises.mkdir(framesDir, { recursive: true });

        let offset = 0;
        const frameCount = buf.readUInt32LE(offset);
        offset += 4;
        if (frameCount === 0 || frameCount > 15_000) {
          return res.status(400).json({ error: `Invalid frame count (${frameCount}).` });
        }

        for (let i = 0; i < frameCount; i++) {
          if (offset + 4 > buf.length) {
            return res.status(400).json({ error: 'Truncated frame length header.' });
          }
          const frameLen = buf.readUInt32LE(offset);
          offset += 4;
          if (offset + frameLen > buf.length) {
            return res.status(400).json({ error: 'Truncated frame payload.' });
          }
          const framePath = path.join(framesDir, `frame_${String(i).padStart(5, '0')}.jpg`);
          await fs.promises.writeFile(framePath, buf.subarray(offset, offset + frameLen));
          offset += frameLen;
        }

        let audioPath: string | null = null;
        if (offset + 4 <= buf.length) {
          const audioLen = buf.readUInt32LE(offset);
          offset += 4;
          if (audioLen > 0 && offset + audioLen <= buf.length) {
            audioPath = path.join(jobDir, `audio_${String(sceneIndex).padStart(3, '0')}.wav`);
            await fs.promises.writeFile(audioPath, buf.subarray(offset, offset + audioLen));
          }
        }

        const sceneMp4 = path.join(jobDir, `scene_${String(sceneIndex).padStart(3, '0')}.mp4`);
        const framePattern = path.join(framesDir, 'frame_%05d.jpg');
        const durationSec = (frameCount / fps).toFixed(3);

        const args = audioPath
          ? [
              '-y',
              '-framerate',
              String(fps),
              '-i',
              framePattern,
              '-i',
              audioPath,
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '20',
              '-pix_fmt',
              'yuv420p',
              '-r',
              String(fps),
              '-c:a',
              'aac',
              '-ar',
              '44100',
              '-ac',
              '2',
              '-b:a',
              '192k',
              '-shortest',
              '-movflags',
              '+faststart',
              sceneMp4,
            ]
          : [
              '-y',
              '-framerate',
              String(fps),
              '-i',
              framePattern,
              '-f',
              'lavfi',
              '-t',
              durationSec,
              '-i',
              'anullsrc=channel_layout=stereo:sample_rate=44100',
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '20',
              '-pix_fmt',
              'yuv420p',
              '-r',
              String(fps),
              '-c:a',
              'aac',
              '-ar',
              '44100',
              '-ac',
              '2',
              '-b:a',
              '192k',
              '-shortest',
              '-movflags',
              '+faststart',
              sceneMp4,
            ];

        await execFileAsync('ffmpeg', args, { timeout: 180_000 });
        await fs.promises.rm(framesDir, { recursive: true, force: true }).catch(() => {});
        if (audioPath) await fs.promises.unlink(audioPath).catch(() => {});

        if (returnClip) {
          let sendPath = sceneMp4;
          if (returnFormat === 'mkv') {
            sendPath = path.join(jobDir, `clip_${sceneIndex}.mkv`);
            await execFileAsync('ffmpeg', ['-y', '-i', sceneMp4, '-c', 'copy', sendPath], {
              timeout: 60_000,
            });
          } else if (returnFormat === 'webm') {
            sendPath = path.join(jobDir, `clip_${sceneIndex}.webm`);
            await execFileAsync(
              'ffmpeg',
              ['-y', '-i', sceneMp4, '-c:v', 'libvpx', '-b:v', '4M', '-c:a', 'libopus', sendPath],
              { timeout: 120_000 },
            );
          }
          const outBuf = await fs.promises.readFile(sendPath);
          await fs.promises.rm(jobDir, { recursive: true, force: true }).catch(() => {});
          res.setHeader(
            'Content-Type',
            returnFormat === 'mkv'
              ? 'video/x-matroska'
              : returnFormat === 'webm'
                ? 'video/webm'
                : 'video/mp4',
          );
          return res.send(outBuf);
        }

        const stat = await fs.promises.stat(sceneMp4);
        return res.json({ ok: true, sceneIndex, sizeBytes: stat.size });
      } catch (err) {
        console.error('FFmpeg render-scene error:', err);
        await fs.promises.rm(framesDir, { recursive: true, force: true }).catch(() => {});
        return res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to encode rendered 3D scene.',
        });
      }
    },
  );

  // CONCATENATE RENDERED SCENE MP4 CLIPS INTO FINAL MP4 / MKV / WEBM
  app.post('/api/studio/finalize-video', async (req, res) => {
    const rawJobId = String(req.body?.jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const sceneCount = Math.max(1, Math.min(200, Number(req.body?.sceneCount) || 1));
    const format =
      req.body?.format === 'mkv' ? 'mkv' : req.body?.format === 'webm' ? 'webm' : 'mp4';

    if (!rawJobId) {
      return res.status(400).json({ error: 'jobId is required.' });
    }
    const jobDir = path.join(os.tmpdir(), 'storyline-renders', rawJobId);
    const listPath = path.join(jobDir, 'concat.txt');
    const mergedMp4 = path.join(jobDir, 'final.mp4');
    const finalPath = path.join(jobDir, `final.${format}`);

    try {
      const entries: string[] = [];
      for (let i = 0; i < sceneCount; i++) {
        const clipPath = path.join(jobDir, `scene_${String(i).padStart(3, '0')}.mp4`);
        if (fs.existsSync(clipPath)) {
          entries.push(`file '${clipPath.replace(/'/g, "'\\''")}'`);
        }
      }
      if (entries.length === 0) {
        return res.status(400).json({ error: 'No rendered scene clips found for this job.' });
      }

      await fs.promises.writeFile(listPath, entries.join('\n'), 'utf8');
      await execFileAsync(
        'ffmpeg',
        ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', mergedMp4],
        { timeout: 180_000 },
      );

      if (format === 'mkv') {
        await execFileAsync('ffmpeg', ['-y', '-i', mergedMp4, '-c', 'copy', finalPath], {
          timeout: 120_000,
        });
      } else if (format === 'webm') {
        await execFileAsync(
          'ffmpeg',
          ['-y', '-i', mergedMp4, '-c:v', 'libvpx', '-b:v', '4M', '-c:a', 'libopus', finalPath],
          { timeout: 180_000 },
        );
      }

      const outBuf = await fs.promises.readFile(finalPath);
      res.setHeader(
        'Content-Type',
        format === 'mkv' ? 'video/x-matroska' : format === 'webm' ? 'video/webm' : 'video/mp4',
      );
      res.setHeader('Content-Disposition', `attachment; filename="storyline-video.${format}"`);
      return res.send(outBuf);
    } catch (err) {
      console.error('FFmpeg finalize-video error:', err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to stitch scene clips into video.',
      });
    } finally {
      await fs.promises.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // STAGE 5: TITLE & THUMBNAIL EXPERT + YOUTUBE DESCRIPTION
  app.post('/api/studio/packaging', async (req, res) => {
    try {
      const ai = getAiClient();
      const topicOrScript = typeof req.body?.topicOrScript === 'string' ? req.body.topicOrScript.trim() : '';

      if (!topicOrScript) {
        return res.status(400).json({ error: 'Provide a topic or script summary to analyze.' });
      }

      const packagingLab = await generatePackagingData(ai, topicOrScript);
      res.json({ packagingLab });
    } catch (error) {
      console.error('Stage 5 Packaging error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate packaging' });
    }
  });

  // STAGE 6: THE 60-DAY GROWTH PLAN
  app.post('/api/studio/growth', async (req, res) => {
    try {
      const ai = getAiClient();
      const hoursPerDay = Number(req.body?.hoursPerDay) || 2;
      const budget =
        typeof req.body?.budget === 'string' && req.body.budget.trim()
          ? req.body.budget.trim()
          : '$0 (Free AI & Browser Production Tools)';

      const prompt = `Act as a YouTube growth strategist.
Build a realistic 60-day launch plan (8 weeks) for my locked niche channel: "${LOCKED_NICHE_DESCRIPTION}".
Creator constraints:
- Available time: ${hoursPerDay} hours/day
- Budget: ${budget}
- Target upload cadence: 1 long-form motivational story video per day (plus optional Shorts clipped from daily episodes)

Requirements:
- Create 8 weekly milestones (Week 1 through Week 8) covering research, scripting, production, publishing, Shorts, and engagement.
- Recommend a sustainable 1-video/day upload schedule and repeatable daily workflow tailored to ${hoursPerDay} hrs/day and ${budget}.
- List key analytics to track and weekly improvement actions.
- Include accurate YouTube Partner Program (YPP) monetization eligibility requirements (both Fan Funding tier: 500 subscribers + 3 valid public uploads in 90 days + 3,000 public watch hours in 12 months OR 3M Shorts views in 90 days; and Ad Revenue tier: 1,000 subscribers + 4,000 public watch hours in 12 months OR 10M Shorts views in 90 days).
- CRITICAL: Explicitly include a disclaimer that eligibility does NOT guarantee monetization or specific revenue.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'You are a pragmatic YouTube growth strategist. Never promise guaranteed monetization or invented growth numbers.',
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              hoursPerDay: { type: Type.NUMBER },
              budget: { type: Type.STRING },
              weeklyMilestones: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    weekNumber: { type: Type.INTEGER },
                    phaseTitle: { type: Type.STRING },
                    research: { type: Type.STRING },
                    scripting: { type: Type.STRING },
                    production: { type: Type.STRING },
                    publishing: { type: Type.STRING },
                    shorts: { type: Type.STRING },
                    engagement: { type: Type.STRING },
                  },
                  required: [
                    'weekNumber',
                    'phaseTitle',
                    'research',
                    'scripting',
                    'production',
                    'publishing',
                    'shorts',
                    'engagement',
                  ],
                },
              },
              uploadSchedule: {
                type: Type.OBJECT,
                properties: {
                  longFormCadence: { type: Type.STRING },
                  shortsCadence: { type: Type.STRING },
                  bestRoutineNote: { type: Type.STRING },
                },
                required: ['longFormCadence', 'shortsCadence', 'bestRoutineNote'],
              },
              productionWorkflow: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    stepNumber: { type: Type.INTEGER },
                    stepName: { type: Type.STRING },
                    timeAllocation: { type: Type.STRING },
                    details: { type: Type.STRING },
                  },
                  required: ['stepNumber', 'stepName', 'timeAllocation', 'details'],
                },
              },
              keyAnalytics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    metric: { type: Type.STRING },
                    whatItShows: { type: Type.STRING },
                    weeklyAction: { type: Type.STRING },
                  },
                  required: ['metric', 'whatItShows', 'weeklyAction'],
                },
              },
              weeklyImprovements: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              monetizationEligibility: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tierName: { type: Type.STRING },
                    subscriberThreshold: { type: Type.STRING },
                    watchOrShortsThreshold: { type: Type.STRING },
                    additionalNotes: { type: Type.STRING },
                  },
                  required: ['tierName', 'subscriberThreshold', 'watchOrShortsThreshold', 'additionalNotes'],
                },
              },
              disclaimer: { type: Type.STRING },
            },
            required: [
              'hoursPerDay',
              'budget',
              'weeklyMilestones',
              'uploadSchedule',
              'productionWorkflow',
              'keyAnalytics',
              'weeklyImprovements',
              'monetizationEligibility',
              'disclaimer',
            ],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      res.json({ growthPlan: parsed });
    } catch (error) {
      console.error('Stage 6 Growth error:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to generate 60-day growth plan' });
    }
  });

  // MORNING AUTO-PIPELINE ENGINE & VAULT ENDPOINTS
  class PipelineCancelledError extends Error {
    constructor() {
      super('Pipeline stopped by creator.');
    }
  }

  const pipelineStatus: {
    isRunning: boolean;
    cancelRequested: boolean;
    stoppedDate: string | null;
    activeStep: string | null;
    lastError: string | null;
  } = {
    isRunning: false,
    cancelRequested: false,
    stoppedDate: null,
    activeStep: null,
    lastError: null,
  };

  function assertNotCancelled() {
    if (pipelineStatus.cancelRequested) {
      throw new PipelineCancelledError();
    }
  }

  async function runMorningPipeline(options?: { projectId?: string; forceFresh?: boolean }) {
    if (pipelineStatus.isRunning) return;
    pipelineStatus.isRunning = true;
    pipelineStatus.cancelRequested = false;
    pipelineStatus.lastError = null;
    pipelineStatus.activeStep = 'Checking channel project & daily queue...';

    try {
      const ai = getAiClient();
      const vault = await readVault();
      assertNotCancelled();
      const { settings } = vault;
      const { projects } = await listProjects();
      assertNotCancelled();
      const targetProject =
        (options?.projectId ? projects.find((p) => p.id === options.projectId) : null) || projects[0];
      if (!targetProject) {
        throw new Error('No channel project available for daily automation.');
      }

      const count = Math.max(1, Math.min(3, settings.dailyCount || 1));
      const { dateStr: todayStr } = getUserLocalDateTime(settings.timezoneOffsetMinutes ?? 0);

      // Identify existing unproduced ideas in Stage 2
      const producedIds = new Set(vault.episodes.map((e) => e.idea.id));
      const producedTitles = new Set(vault.episodes.map((e) => e.idea.title.toLowerCase()));

      const unproducedIdeas = (targetProject.contentIdeas || []).filter(
        (i) => !producedIds.has(i.id) && !producedTitles.has(i.title.toLowerCase()),
      );

      let targetIdeas: ContentIdea[] = [];
      let updatedProjectIdeas = [...(targetProject.contentIdeas || [])];

      if (!options?.forceFresh && settings.onlyIfIdeasEmpty && unproducedIdeas.length > 0) {
        // Shortlist existing unproduced ideas (up to daily count) if user already had them queued
        targetIdeas = unproducedIdeas.slice(0, count).map((i) => ({
          ...i,
          shortlisted: settings.autoShortlistAll ? true : i.shortlisted,
        }));
        const targetIds = new Set(targetIdeas.map((i) => i.id));
        updatedProjectIdeas = updatedProjectIdeas.map((i) =>
          targetIds.has(i.id) && settings.autoShortlistAll ? { ...i, shortlisted: true } : i,
        );
      } else {
        // Generate N fresh daily ideas & shortlist all of them
        pipelineStatus.activeStep = `Generating ${count} daily story ideas...`;
        const allSeenTitles = [
          ...updatedProjectIdeas.map((i) => i.title),
          ...vault.episodes.map((e) => e.idea.title),
        ];
        const nicheFocus = targetProject.nicheStrategy?.strongestRecommendation?.optionTitle
          ? `Motivational storytelling (${targetProject.nicheStrategy.strongestRecommendation.optionTitle})`
          : 'Balanced mix of imaginary parables, historical turning points, and mythological wisdom for aspirants';
        const fresh = await generateIdeasBatch(ai, nicheFocus, allSeenTitles, count);
        assertNotCancelled();
        targetIdeas = fresh.map((i) => ({
          ...i,
          shortlisted: settings.autoShortlistAll ? true : false,
        }));
        updatedProjectIdeas = [...targetIdeas, ...updatedProjectIdeas].map((item, idx) => ({
          ...item,
          rankIndex: idx + 1,
        }));
      }

      await updateProject(targetProject.id, { contentIdeas: updatedProjectIdeas });
      assertNotCancelled();

      let latestScript: ScriptData | null = targetProject.scriptStage;
      let latestVisuals: VisualPlan | null = targetProject.visualPlan;
      let latestPackaging: PackagingData | null = targetProject.packagingLab;

      for (let idx = 0; idx < targetIdeas.length; idx++) {
        assertNotCancelled();
        const idea = targetIdeas[idx];
        const label = `Episode ${idx + 1}/${targetIdeas.length}`;

        pipelineStatus.activeStep = `${label}: Writing 3-min script...`;
        const scriptStage = await generateScriptData(ai, {
          ideaId: idea.id,
          topic: idea.title,
          targetAudience: idea.targetViewer,
          durationMinutes: 3,
          storySource: idea.recommendedFormat || 'Motivational Short Story',
        });
        assertNotCancelled();

        const scriptPlainText = [
          `Topic: ${scriptStage.topic}`,
          `Hook (0:00-0:10): ${scriptStage.hook10Seconds}`,
          ...scriptStage.sections.map(
            (sec, sIdx) =>
              `Section ${sIdx + 1} - ${sec.sectionTitle} (${sec.estimatedSeconds}s):\n${sec.narration}`,
          ),
          `Closing: ${scriptStage.closingCallToAction}`,
        ].join('\n\n');

        pipelineStatus.activeStep = `${label}: Directing 3D scenes & prompts...`;
        const visualPlan = await generateVisualsData(
          ai,
          scriptPlainText,
          'Obsidian Slate & Warm Amber Chiaroscuro',
        );
        assertNotCancelled();

        const episodeId = crypto.randomUUID();
        const audioSceneNumbers: number[] = [];

        // Pre-synthesize scene narration WAVs cleanly on server disk with Free Tier RPM pacing
        const scenes = visualPlan.scenes || [];
        for (let s = 0; s < scenes.length; s++) {
          assertNotCancelled();
          const sc = scenes[s];
          pipelineStatus.activeStep = `${label}: Synthesizing voiceover (${s + 1}/${scenes.length})...`;
          if (s > 0) {
            await new Promise((r) => setTimeout(r, 450));
            assertNotCancelled();
          }
          try {
            const tts = await synthesizeWavBase64(ai, sc.narrationCue, sc.voiceName || 'Charon');
            saveEpisodeAudioFile(episodeId, sc.sceneNumber, tts.audioBase64);
            audioSceneNumbers.push(sc.sceneNumber);
          } catch (firstErr) {
            assertNotCancelled();
            // Brief backoff retry for free-tier rate spikes
            await new Promise((r) => setTimeout(r, 2500));
            assertNotCancelled();
            try {
              const ttsRetry = await synthesizeWavBase64(ai, sc.narrationCue, sc.voiceName || 'Charon');
              saveEpisodeAudioFile(episodeId, sc.sceneNumber, ttsRetry.audioBase64);
              audioSceneNumbers.push(sc.sceneNumber);
            } catch {
              console.warn(`Scene ${sc.sceneNumber} TTS warning:`, firstErr);
            }
          }
        }
        assertNotCancelled();

        // Build chapter hints for YouTube description timestamps
        let cursorSec = 0;
        const chapterHints = scenes
          .map((sc) => {
            const mm = Math.floor(cursorSec / 60);
            const ss = String(cursorSec % 60).padStart(2, '0');
            cursorSec += sc.durationSeconds || 15;
            return `${mm}:${ss} - ${sc.title}`;
          })
          .join('\n');

        pipelineStatus.activeStep = `${label}: Creating titles, 5 thumbnails & YouTube description...`;
        const packagingLab = await generatePackagingData(ai, scriptPlainText, chapterHints);
        assertNotCancelled();

        const episode: DailyEpisode = {
          id: episodeId,
          projectId: targetProject.id,
          createdDate: todayStr,
          createdAt: new Date().toISOString(),
          idea: { ...idea, shortlisted: true },
          scriptStage,
          visualPlan,
          packagingLab,
          audioSceneNumbers,
          status: 'ready',
        };

        const latestVault = await readVault();
        latestVault.episodes.unshift(episode);
        latestVault.settings.lastRunDate = todayStr;
        latestVault.settings.lastRunSummary = `Prepared ${idx + 1}/${targetIdeas.length} episode(s) on ${todayStr}`;
        await writeVault(latestVault);

        latestScript = scriptStage;
        latestVisuals = visualPlan;
        latestPackaging = packagingLab;
      }

      // Sync the latest generated episode into the project's active stages for seamless 3D Studio editing
      await updateProject(targetProject.id, {
        scriptStage: latestScript,
        visualPlan: latestVisuals,
        packagingLab: latestPackaging,
      });

      const finalVault = await readVault();
      finalVault.settings.lastRunDate = todayStr;
      finalVault.settings.lastRunSummary = `Prepared ${targetIdeas.length} ready-to-upload episode(s) on ${todayStr}`;
      await writeVault(finalVault);
    } catch (err) {
      if (err instanceof PipelineCancelledError) {
        const stoppedVault = await readVault();
        stoppedVault.settings.lastRunSummary = 'Morning schedule stopped by creator.';
        await writeVault(stoppedVault);
        pipelineStatus.lastError = null;
      } else {
        console.error('Morning pipeline failed:', err);
        pipelineStatus.lastError =
          err instanceof Error ? err.message : 'Morning auto-pipeline encountered an error.';
      }
    } finally {
      pipelineStatus.isRunning = false;
      pipelineStatus.cancelRequested = false;
      pipelineStatus.activeStep = null;
    }
  }

  function maybeTriggerMorningSchedule(offsetOverride?: number) {
    if (pipelineStatus.isRunning) return;
    void (async () => {
      try {
        const vault = await readVault();
        if (!vault.settings.enabled) return;
        const tzOffset =
          typeof offsetOverride === 'number'
            ? offsetOverride
            : (vault.settings.timezoneOffsetMinutes ?? 0);
        const { dateStr, hhmm } = getUserLocalDateTime(tzOffset);
        if (
          pipelineStatus.stoppedDate !== dateStr &&
          vault.settings.lastRunDate !== dateStr &&
          hhmm >= vault.settings.morningTime
        ) {
          await runMorningPipeline({ forceFresh: false });
        }
      } catch {
        // Silent background guard
      }
    })();
  }

  // Check once per minute for scheduled morning execution while server runs
  setInterval(() => {
    maybeTriggerMorningSchedule();
  }, 60_000);

  app.get('/api/vault', async (req, res) => {
    try {
      const tzParam = Number(req.query?.tzOffset);
      const vault = await readVault();
      if (!Number.isNaN(tzParam) && vault.settings.timezoneOffsetMinutes !== tzParam) {
        vault.settings.timezoneOffsetMinutes = tzParam;
        await writeVault(vault);
      }
      // Morning catch-up check if container woke up past today's scheduled morning time
      if (vault.settings.enabled && !pipelineStatus.isRunning) {
        const { dateStr, hhmm } = getUserLocalDateTime(vault.settings.timezoneOffsetMinutes ?? 0);
        if (
          pipelineStatus.stoppedDate !== dateStr &&
          vault.settings.lastRunDate !== dateStr &&
          hhmm >= vault.settings.morningTime
        ) {
          void runMorningPipeline({ forceFresh: false });
        }
      }
      res.json({
        settings: vault.settings,
        episodes: vault.episodes,
        isRunning: pipelineStatus.isRunning,
        cancelRequested: pipelineStatus.cancelRequested,
        activeStep: pipelineStatus.activeStep,
        lastError: pipelineStatus.lastError,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load vault' });
    }
  });

  app.patch('/api/vault/settings', async (req, res) => {
    try {
      const vault = await readVault();
      const body = req.body || {};
      vault.settings = {
        ...vault.settings,
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(typeof body.morningTime === 'string' && /^\d{2}:\d{2}$/.test(body.morningTime)
          ? { morningTime: body.morningTime }
          : {}),
        ...(typeof body.dailyCount === 'number'
          ? { dailyCount: Math.max(1, Math.min(3, Math.round(body.dailyCount))) }
          : {}),
        ...(typeof body.onlyIfIdeasEmpty === 'boolean'
          ? { onlyIfIdeasEmpty: body.onlyIfIdeasEmpty }
          : {}),
        ...(typeof body.autoShortlistAll === 'boolean'
          ? { autoShortlistAll: body.autoShortlistAll }
          : {}),
        ...(typeof body.timezoneOffsetMinutes === 'number'
          ? { timezoneOffsetMinutes: body.timezoneOffsetMinutes }
          : {}),
      };
      if (body.enabled === true) {
        pipelineStatus.stoppedDate = null;
      }
      await writeVault(vault);
      res.json({ settings: vault.settings });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update schedule' });
    }
  });

  app.post('/api/vault/run', async (req, res) => {
    if (pipelineStatus.isRunning) {
      return res.json({
        started: false,
        isRunning: true,
        cancelRequested: pipelineStatus.cancelRequested,
        activeStep: pipelineStatus.activeStep,
      });
    }
    pipelineStatus.stoppedDate = null;
    pipelineStatus.cancelRequested = false;
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;
    const forceFresh = Boolean(req.body?.forceFresh);
    void runMorningPipeline({ projectId, forceFresh });
    res.json({ started: true, isRunning: true, cancelRequested: false });
  });

  app.post('/api/vault/stop', async (_req, res) => {
    const vault = await readVault();
    const { dateStr } = getUserLocalDateTime(vault.settings.timezoneOffsetMinutes ?? 0);
    pipelineStatus.stoppedDate = dateStr;
    if (!pipelineStatus.isRunning) {
      return res.json({ stopped: true, isRunning: false, cancelRequested: false });
    }
    pipelineStatus.cancelRequested = true;
    pipelineStatus.activeStep = 'Stopping morning pipeline...';
    return res.json({ stopped: false, isRunning: true, cancelRequested: true });
  });

  app.post('/api/vault/episodes/from-studio', async (req, res) => {
    try {
      const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : '';
      const { projects } = await listProjects();
      const proj = (projectId ? projects.find((p) => p.id === projectId) : null) || projects[0];
      if (!proj?.scriptStage || !proj?.visualPlan) {
        return res.status(400).json({
          error: 'Generate at least a Script (Stage 3) and 3D Scenes (Stage 4) first.',
        });
      }

      const vault = await readVault();
      const { dateStr: todayStr } = getUserLocalDateTime(
        vault.settings.timezoneOffsetMinutes ?? 0,
      );

      const matchedIdea =
        proj.contentIdeas.find(
          (i) => i.id === proj.scriptStage?.ideaId || i.title === proj.scriptStage?.topic,
        ) || {
          id: proj.scriptStage.ideaId || crypto.randomUUID(),
          rankIndex: 1,
          title: proj.scriptStage.topic,
          centralTopic: proj.scriptStage.topic,
          targetViewer: proj.scriptStage.targetAudience,
          recommendedFormat: '3D Faceless Story',
          category: 'Storytelling' as const,
          reasonPeopleWatch: 'Motivational short story production set',
          shortlisted: true,
        };

      const packagingLab: PackagingData = proj.packagingLab || {
        analyzedTopic: proj.scriptStage.topic,
        youtubeDescription: `${proj.scriptStage.hook10Seconds}\n\n#motivation #storytelling`,
        youtubeTags: ['motivation', 'short story', 'discipline', 'mindset'],
        titles: [
          {
            rank: 1,
            title: proj.scriptStage.topic,
            angle: 'Core Story',
            curiosityMechanism: 'Narrative hook',
          },
        ],
        thumbnails: [],
        topThree: [
          {
            rank: 1,
            title: proj.scriptStage.topic,
            thumbnailConceptName: 'Stage 4 Snapshot',
            whyStrongest: 'Primary studio concept',
          },
        ],
      };

      const episodeId = crypto.randomUUID();
      const episode: DailyEpisode = {
        id: episodeId,
        projectId: proj.id,
        createdDate: todayStr,
        createdAt: new Date().toISOString(),
        idea: { ...matchedIdea, shortlisted: true },
        scriptStage: proj.scriptStage,
        visualPlan: proj.visualPlan,
        packagingLab,
        audioSceneNumbers: [],
        status: 'ready',
      };

      vault.episodes.unshift(episode);
      await writeVault(vault);
      res.status(201).json({ episode });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to save studio episode',
      });
    }
  });

  app.patch('/api/vault/episodes/:id', async (req, res) => {
    try {
      const vault = await readVault();
      const idx = vault.episodes.findIndex((e) => e.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Episode not found' });
      const status = req.body?.status === 'exported' ? 'exported' : 'ready';
      vault.episodes[idx] = { ...vault.episodes[idx], status };
      await writeVault(vault);
      res.json({ episode: vault.episodes[idx] });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update episode' });
    }
  });

  app.delete('/api/vault/episodes/:id', async (req, res) => {
    try {
      const vault = await readVault();
      vault.episodes = vault.episodes.filter((e) => e.id !== req.params.id);
      await writeVault(vault);
      deleteEpisodeAudioDir(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete episode' });
    }
  });

  app.get('/api/vault/episodes/:id/audio/:sceneNumber', async (req, res) => {
    try {
      const sceneNum = Number(req.params.sceneNumber);
      const filePath = getEpisodeAudioPath(req.params.id, sceneNum);
      if (!fs.existsSync(filePath)) {
        // Re-synthesize lazily if cached file was cleared
        const vault = await readVault();
        const ep = vault.episodes.find((e) => e.id === req.params.id);
        const sc = ep?.visualPlan?.scenes?.find((s) => s.sceneNumber === sceneNum);
        if (!ep || !sc) {
          return res.status(404).json({ error: 'Audio scene not found' });
        }
        const ai = getAiClient();
        const tts = await synthesizeWavBase64(ai, sc.narrationCue, sc.voiceName || 'Charon');
        saveEpisodeAudioFile(ep.id, sc.sceneNumber, tts.audioBase64);
      }
      if (req.query.download === '1') {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="episode-scene-${sceneNum}.wav"`,
        );
      }
      res.setHeader('Content-Type', 'audio/wav');
      res.sendFile(filePath);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to serve scene audio' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Storyline Director server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
