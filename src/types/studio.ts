export type StageId = 1 | 2 | 3 | 4 | 5 | 6;

export type CharacterAction =
  | 'idle_breath'
  | 'storyteller_gesture'
  | 'emphasize_point'
  | 'heroic_stance'
  | 'reflective_nod'
  | 'dramatic_lean';

export type StoryActivity =
  | 'orator_walk'
  | 'forge_labor'
  | 'climb_ascent'
  | 'scholar_study'
  | 'duel_overcome'
  | 'triumph_raise';

export type CameraPreset =
  | 'wide_stage'
  | 'medium_shot'
  | 'closeup_lipsync'
  | 'low_hero';

export type LightingMood =
  | 'warm_dawn'
  | 'torchlit_mythic'
  | 'obsidian_studio';

export type StageSet =
  | 'philosopher_pillar'
  | 'summit_overlook'
  | 'ancient_archive';

export type VoiceName = 'Charon' | 'Kore' | 'Fenrir' | 'Puck' | 'Zephyr';

export type IdeaCategory = 'Evergreen' | 'Trending' | 'Educational' | 'Storytelling';

export interface RankedOption {
  rank: number;
  title: string;
  summary: string;
  effortLevel: string;
  monetizationFit: string;
  whyRanked: string;
}

export interface NicheStrategy {
  nicheSummary: string;
  audienceBreakdown: {
    segment: string;
    mindset: string;
    coreDesire: string;
  }[];
  contentOpportunities: {
    pillar: string;
    storySource: string;
    angle: string;
  }[];
  challenges: {
    challenge: string;
    mitigation: string;
  }[];
  monetizationMethods: {
    method: string;
    description: string;
    readinessStage: string;
  }[];
  rankedOptions: RankedOption[];
  strongestRecommendation: {
    optionTitle: string;
    rationale: string;
    firstStepFocus: string;
  };
}

export interface ContentIdea {
  id: string;
  rankIndex: number;
  title: string;
  centralTopic: string;
  targetViewer: string;
  recommendedFormat: string;
  category: IdeaCategory;
  reasonPeopleWatch: string;
  shortlisted?: boolean;
}

export interface ScriptSection {
  sectionTitle: string;
  estimatedSeconds: number;
  narration: string;
  patternInterrupt: string;
  transitionLine: string;
}

export interface ScriptData {
  ideaId?: string;
  topic: string;
  targetAudience: string;
  durationMinutes: number;
  hook10Seconds: string;
  sections: ScriptSection[];
  closingCallToAction: string;
  estimatedWordCount: number;
}

export interface SceneItem {
  sceneNumber: number;
  title: string;
  narrationCue: string;
  visualDescription: string;
  imagePrompt: string;
  videoPrompt: string;
  brollSuggestion: string;
  onScreenText: string;
  durationSeconds: number;
  action: CharacterAction;
  storyActivity?: StoryActivity;
  cameraPreset: CameraPreset;
  lightingMood: LightingMood;
  stageSet: StageSet;
  voiceName: VoiceName;
  lipSyncIntensity: number;
}

export interface VisualPlan {
  styleBible: {
    colorPalette: string;
    lightingDirection: string;
    visualStyle: string;
    cameraLanguage: string;
  };
  scenes: SceneItem[];
}

export interface TitleIdea {
  rank: number;
  title: string;
  angle: string;
  curiosityMechanism: string;
}

export interface ThumbnailConcept {
  id: string;
  conceptName: string;
  subject: string;
  background: string;
  composition: string;
  colors: string[];
  shortText: string;
  curiosityBehindPairing: string;
}

export interface TopThreePairing {
  rank: number;
  title: string;
  thumbnailConceptName: string;
  whyStrongest: string;
}

export interface PackagingData {
  analyzedTopic: string;
  youtubeDescription?: string;
  youtubeTags?: string[];
  titles: TitleIdea[];
  thumbnails: ThumbnailConcept[];
  topThree: TopThreePairing[];
}

export interface WeeklyMilestone {
  weekNumber: number;
  phaseTitle: string;
  research: string;
  scripting: string;
  production: string;
  publishing: string;
  shorts: string;
  engagement: string;
}

export interface GrowthPlan {
  hoursPerDay: number;
  budget: string;
  weeklyMilestones: WeeklyMilestone[];
  uploadSchedule: {
    longFormCadence: string;
    shortsCadence: string;
    bestRoutineNote: string;
  };
  productionWorkflow: {
    stepNumber: number;
    stepName: string;
    timeAllocation: string;
    details: string;
  }[];
  keyAnalytics: {
    metric: string;
    whatItShows: string;
    weeklyAction: string;
  }[];
  weeklyImprovements: string[];
  monetizationEligibility: {
    tierName: string;
    subscriberThreshold: string;
    watchOrShortsThreshold: string;
    additionalNotes: string;
  }[];
  disclaimer: string;
}

export interface StudioProject {
  id: string;
  title: string;
  activeStage: StageId;
  nicheStrategy: NicheStrategy | null;
  contentIdeas: ContentIdea[];
  scriptStage: ScriptData | null;
  visualPlan: VisualPlan | null;
  packagingLab: PackagingData | null;
  growthPlan: GrowthPlan | null;
  createdAt: string;
  updatedAt: string;
}

export interface LipSyncTelemetry {
  isPlaying: boolean;
  isSynthesizing: boolean;
  jawOpen: number;
  lipSpread: number;
  energyBands: number[];
  sourceMode: 'tts-audio' | 'cadence-preview' | 'idle';
}

export interface AutomationSettings {
  enabled: boolean;
  morningTime: string; // HH:MM 24h format e.g. "07:00"
  dailyCount: number; // default 2
  onlyIfIdeasEmpty: boolean;
  autoShortlistAll: boolean;
  timezoneOffsetMinutes?: number;
  lastRunDate: string | null; // YYYY-MM-DD
  lastRunSummary: string | null;
}

export interface DailyEpisode {
  id: string;
  projectId: string;
  createdDate: string; // YYYY-MM-DD
  createdAt: string;
  idea: ContentIdea;
  scriptStage: ScriptData;
  visualPlan: VisualPlan;
  packagingLab: PackagingData;
  audioSceneNumbers: number[];
  status: 'ready' | 'exported';
}

export interface VaultStateResponse {
  settings: AutomationSettings;
  episodes: DailyEpisode[];
  isRunning: boolean;
  cancelRequested?: boolean;
  activeStep: string | null;
  lastError: string | null;
}
