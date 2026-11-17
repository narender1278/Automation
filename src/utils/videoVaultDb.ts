const DB_NAME = 'storyline_video_vault';
const STORE_NAME = 'rendered_clips';
const DB_VERSION = 1;

export interface StoredVideoEntry {
  key: string; // e.g. `ep:<episodeId>:full` or `ep:<episodeId>:scene:<num>`
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  updatedAt: string;
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open video cache DB'));
  });
}

export async function saveRenderedVideoBlob(key: string, blob: Blob): Promise<void> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const entry: StoredVideoEntry = {
      key,
      blob,
      mimeType: blob.type || 'video/webm',
      sizeBytes: blob.size,
      updatedAt: new Date().toISOString(),
    };
    store.put(entry);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to save rendered video'));
    };
  });
}

export async function getRenderedVideoBlob(key: string): Promise<StoredVideoEntry | null> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as StoredVideoEntry | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error('Failed to read rendered video'));
    };
  });
}

export async function listRenderedVideoMeta(): Promise<Record<string, { sizeBytes: number; updatedAt: string }>> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      db.close();
      const map: Record<string, { sizeBytes: number; updatedAt: string }> = {};
      const entries = (req.result as StoredVideoEntry[]) || [];
      for (const e of entries) {
        map[e.key] = { sizeBytes: e.sizeBytes, updatedAt: e.updatedAt };
      }
      resolve(map);
    };
    req.onerror = () => {
      db.close();
      reject(req.error || new Error('Failed to list cached videos'));
    };
  });
}

export async function deleteEpisodeVideoBlobs(episodeId: string): Promise<void> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      const prefix = `ep:${episodeId}:`;
      for (const k of req.result) {
        if (typeof k === 'string' && k.startsWith(prefix)) {
          store.delete(k);
        }
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to clean up episode clips'));
    };
  });
}
