export type VideoExportFormat = 'mp4' | 'mkv' | 'webm';

/**
 * Creates a Web Worker-backed interval ticker that is NOT throttled by browsers
 * when switching tabs or running exports in the background.
 */
export function startWorkerInterval(
  callback: () => void,
  intervalMs = 33,
): () => void {
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    try {
      const code = `
        let timer = setInterval(() => self.postMessage(1), ${Math.max(16, intervalMs)});
        self.onmessage = (e) => {
          if (e.data === 'stop') {
            clearInterval(timer);
            self.close();
          }
        };
      `;
      const blob = new Blob([code], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      worker.onmessage = () => callback();
      return () => {
        try {
          worker.postMessage('stop');
          worker.terminate();
        } catch {
          // ignore
        }
        URL.revokeObjectURL(url);
      };
    } catch {
      // Fall back to window interval if Worker CSP blocks blob workers
    }
  }

  const id = window.setInterval(callback, intervalMs);
  return () => window.clearInterval(id);
}

/**
 * Unthrottled delay helper that executes accurately even in background browser tabs.
 */
export function workerDelay(ms: number): Promise<void> {
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    try {
      return new Promise((resolve) => {
        const code = `setTimeout(() => { self.postMessage(1); self.close(); }, ${Math.max(0, ms)});`;
        const blob = new Blob([code], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url);
        worker.onmessage = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
        worker.onerror = () => {
          URL.revokeObjectURL(url);
          window.setTimeout(resolve, ms);
        };
      });
    } catch {
      // fall through
    }
  }
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function convertVideoFormat(
  sourceBlob: Blob,
  targetFormat: VideoExportFormat,
): Promise<{ blob: Blob; format: VideoExportFormat }> {
  const sourceType = (sourceBlob.type || '').toLowerCase();
  if (targetFormat === 'webm' && (!sourceType || sourceType.includes('webm'))) {
    return { blob: sourceBlob, format: 'webm' };
  }
  if (targetFormat === 'mp4' && sourceType.includes('mp4')) {
    return { blob: sourceBlob, format: 'mp4' };
  }
  if (targetFormat === 'mkv' && sourceType.includes('matroska')) {
    return { blob: sourceBlob, format: 'mkv' };
  }

  const res = await fetch(`/api/studio/convert-video?format=${encodeURIComponent(targetFormat)}`, {
    method: 'POST',
    headers: { 'Content-Type': sourceBlob.type || 'video/webm' },
    body: sourceBlob,
  });

  if (!res.ok) {
    let errText = 'Video format conversion failed';
    try {
      const json = await res.json();
      if (json?.error) errText = json.error;
    } catch {
      // ignore
    }
    throw new Error(errText);
  }

  const converted = await res.blob();
  return { blob: converted, format: targetFormat };
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}
