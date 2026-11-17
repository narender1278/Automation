import { workerDelay, type VideoExportFormat } from './videoExport';
import type { Stage3DViewportHandle } from '../components/Stage3DViewport';
import type { SceneItem } from '../types/studio';

export interface SceneAudioAnalysis {
  wavBytes: Uint8Array | null;
  durationSec: number;
  frameCount: number;
  jawEnvelope: Float32Array;
  spreadEnvelope: Float32Array;
}

export async function extractSceneAudioAnalysis(
  audioUrlOrDataUrl: string | null,
  fallbackDurationSec: number,
  fps = 24,
): Promise<SceneAudioAnalysis> {
  let wavBytes: Uint8Array | null = null;
  let durationSec = Math.max(2.5, Math.min(25, fallbackDurationSec || 6));

  if (audioUrlOrDataUrl) {
    try {
      const res = await fetch(audioUrlOrDataUrl);
      if (res.ok) {
        const arrBuf = await res.arrayBuffer();
        if (arrBuf.byteLength > 44) {
          wavBytes = new Uint8Array(arrBuf);
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new Ctx();
          try {
            const decoded = await ctx.decodeAudioData(arrBuf.slice(0));
            durationSec = Math.max(0.8, decoded.duration);
            const frameCount = Math.max(12, Math.round(durationSec * fps));
            const jawEnvelope = new Float32Array(frameCount);
            const spreadEnvelope = new Float32Array(frameCount);
            const samples = decoded.getChannelData(0);
            const samplesPerFrame = Math.max(1, Math.floor(samples.length / frameCount));

            // First pass: find peak RMS so quiet & loud voices scale cleanly
            let maxRms = 0.01;
            const rawRms = new Float32Array(frameCount);
            for (let f = 0; f < frameCount; f++) {
              const start = f * samplesPerFrame;
              const end = Math.min(samples.length, start + samplesPerFrame);
              let sumSq = 0;
              for (let s = start; s < end; s++) {
                const v = samples[s];
                sumSq += v * v;
              }
              const rms = Math.sqrt(sumSq / Math.max(1, end - start));
              rawRms[f] = rms;
              if (rms > maxRms) maxRms = rms;
            }

            for (let f = 0; f < frameCount; f++) {
              const norm = Math.min(1, (rawRms[f] / maxRms) * 1.35);
              // Gentle temporal smoothing across adjacent frames for natural mouth inertia
              const prev = f > 0 ? jawEnvelope[f - 1] : 0;
              jawEnvelope[f] = prev * 0.35 + norm * 0.65;
              spreadEnvelope[f] = Math.min(1, jawEnvelope[f] * (0.6 + 0.4 * Math.abs(Math.sin(f * 0.45))));
            }

            return { wavBytes, durationSec, frameCount, jawEnvelope, spreadEnvelope };
          } finally {
            await ctx.close().catch(() => {});
          }
        }
      }
    } catch {
      // Fall back to synthesized syllable cadence below
    }
  }

  const frameCount = Math.max(24, Math.round(durationSec * fps));
  const jawEnvelope = new Float32Array(frameCount);
  const spreadEnvelope = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const t = f / fps;
    const syl =
      Math.max(0, Math.sin(t * 14.5) * 0.55 + Math.sin(t * 7.2 + 1.1) * 0.45) *
      (0.55 + 0.45 * Math.sin(t * 2.8));
    jawEnvelope[f] = Math.min(1, syl);
    spreadEnvelope[f] = Math.abs(Math.cos(t * 9.5)) * jawEnvelope[f];
  }

  return { wavBytes: null, durationSec, frameCount, jawEnvelope, spreadEnvelope };
}

function splitTimedCaption(narration: string, progress01: number): string {
  const clean = narration.trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const words = clean.split(' ');
  const chunkSize = 8;
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
  }
  const idx = Math.min(chunks.length - 1, Math.floor(Math.max(0, Math.min(0.999, progress01)) * chunks.length));
  return chunks[idx] || '';
}

function buildSceneRenderPack(frames: Uint8Array[], wavBytes: Uint8Array | null): Uint8Array {
  let totalBytes = 4 + 4 + (wavBytes ? wavBytes.byteLength : 0);
  for (const f of frames) {
    totalBytes += 4 + f.byteLength;
  }
  const packed = new Uint8Array(totalBytes);
  const view = new DataView(packed.buffer);
  let offset = 0;

  view.setUint32(offset, frames.length, true);
  offset += 4;

  for (const frame of frames) {
    view.setUint32(offset, frame.byteLength, true);
    offset += 4;
    packed.set(frame, offset);
    offset += frame.byteLength;
  }

  const audioLen = wavBytes ? wavBytes.byteLength : 0;
  view.setUint32(offset, audioLen, true);
  offset += 4;
  if (wavBytes && audioLen > 0) {
    packed.set(wavBytes, offset);
  }

  return packed;
}

export interface DeterministicRenderOptions {
  scenes: SceneItem[];
  resolveAudioSrc: (scene: SceneItem) => Promise<string | null>;
  viewport: Stage3DViewportHandle;
  format: VideoExportFormat;
  showOnScreenText: boolean;
  fps?: number;
  shouldCancel: () => boolean;
  onSceneStart?: (scene: SceneItem, index: number, total: number) => void;
  onProgress: (label: string) => void;
}

export async function renderScenesDeterministically(
  opts: DeterministicRenderOptions,
): Promise<Blob | null> {
  const {
    scenes,
    resolveAudioSrc,
    viewport,
    format,
    showOnScreenText,
    fps = 24,
    shouldCancel,
    onSceneStart,
    onProgress,
  } = opts;

  if (scenes.length === 0) return null;

  const jobId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const dt = 1 / fps;
  let globalSimTime = 0;
  let uploadedCount = 0;

  viewport.setManualRenderMode(true);
  try {
    for (let i = 0; i < scenes.length; i++) {
      if (shouldCancel()) return null;
      const sc = scenes[i];
      onSceneStart?.(sc, i, scenes.length);

      onProgress(`Preparing S${String(sc.sceneNumber).padStart(2, '0')} (${i + 1}/${scenes.length}) audio...`);
      const audioSrc = await resolveAudioSrc(sc);
      if (shouldCancel()) return null;

      const analysis = await extractSceneAudioAnalysis(audioSrc, sc.durationSeconds, fps);
      const frameBuffers: Uint8Array[] = [];

      for (let f = 0; f < analysis.frameCount; f++) {
        if (shouldCancel()) return null;
        if (f % 6 === 0 || f === analysis.frameCount - 1) {
          const pct = Math.round(((f + 1) / analysis.frameCount) * 100);
          onProgress(
            scenes.length === 1
              ? `Rendering Scene ${sc.sceneNumber} (${pct}%)`
              : `Rendering S${String(sc.sceneNumber).padStart(2, '0')} (${i + 1}/${scenes.length}) · ${pct}%`,
          );
        }

        const progress01 = analysis.frameCount > 1 ? f / (analysis.frameCount - 1) : 0;
        const jaw = Math.min(1, analysis.jawEnvelope[f] * (sc.lipSyncIntensity || 1.05));
        const spread = analysis.spreadEnvelope[f];
        const caption = splitTimedCaption(sc.narrationCue, progress01);

        const jpgBlob = await viewport.renderFrameAt({
          simTimeSec: globalSimTime,
          deltaSec: dt,
          jawOpen: jaw,
          lipSpread: spread,
          isPlaying: jaw > 0.04,
          sceneProgress01: progress01,
          onScreenText: sc.onScreenText,
          showOnScreenText,
          narrationCaption: caption,
          action: sc.action,
          storyActivity: sc.storyActivity,
          directorBlocks: sc.directorBlocks,
          sceneDurationSec: sc.durationSeconds,
          scriptCue: `${sc.title} ${sc.visualDescription} ${sc.narrationCue}`,
          cameraPreset: sc.cameraPreset,
          lightingMood: sc.lightingMood,
          stageSet: sc.stageSet,
          actionIntensity: sc.lipSyncIntensity || 1.05,
          snapCamera: f === 0,
        });

        if (jpgBlob) {
          frameBuffers.push(new Uint8Array(await jpgBlob.arrayBuffer()));
        }
        globalSimTime += dt;

        // Yield through Web Worker timer so UI remains responsive & background tabs never stall
        if (f % 3 === 0) {
          await workerDelay(0);
        }
      }

      if (shouldCancel()) return null;

      onProgress(
        scenes.length === 1
          ? `Encoding ${format.toUpperCase()}...`
          : `Muxing S${String(sc.sceneNumber).padStart(2, '0')} A/V...`,
      );

      const pack = buildSceneRenderPack(frameBuffers, analysis.wavBytes);
      const isSingleClip = scenes.length === 1;
      const res = await fetch(
        `/api/studio/render-scene?jobId=${encodeURIComponent(jobId)}&sceneIndex=${i}&fps=${fps}&returnClip=${isSingleClip ? '1' : '0'}&format=${encodeURIComponent(format)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: new Blob([pack.buffer as ArrayBuffer], { type: 'application/octet-stream' }),
        },
      );

      if (!res.ok) {
        let msg = `Failed to encode scene ${sc.sceneNumber}`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }

      if (isSingleClip) {
        return await res.blob();
      }
      uploadedCount++;
    }

    if (shouldCancel() || uploadedCount === 0) return null;

    onProgress(`Assembling ${format.toUpperCase()}...`);
    const finalRes = await fetch('/api/studio/finalize-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, sceneCount: uploadedCount, format }),
    });

    if (!finalRes.ok) {
      let msg = 'Failed to assemble final video';
      try {
        const j = await finalRes.json();
        if (j?.error) msg = j.error;
      } catch {
        // ignore
      }
      throw new Error(msg);
    }

    return await finalRes.blob();
  } finally {
    viewport.setManualRenderMode(false);
  }
}
