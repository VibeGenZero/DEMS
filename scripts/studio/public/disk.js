// Disk state of the open editor tabs: the hash each tab was loaded or saved with, and the tabs whose file
// changed on disk while they held unsaved edits (conflicts). The workspace does the requests and dialogs.

export const CONFLICT_TITLE = 'Auf der Platte geändert';

export function createDiskState() {
  const hashes = new Map(); // path -> sha256 of the disk content the tab is based on
  const conflicts = new Set();
  return {
    /** The tab now matches the disk at `hash` (opened, reloaded or saved). */
    track(path, hash) {
      hashes.set(path, hash);
      conflicts.delete(path);
    },
    forget(path) {
      hashes.delete(path);
      conflicts.delete(path);
    },
    hash: (path) => hashes.get(path),
    hasConflict: (path) => conflicts.has(path),
    conflicts: () => new Set(conflicts),
    /**
     * What to do with an open tab after the folder changed. The base hash stays on a conflict,
     * so the tab's next save is refused (409) and asks.
     * @param {string|null} diskHash -> null when the file is gone or cannot be read.
     * @returns {'keep'|'reload'|'conflict'}
     */
    compare(path, diskHash, dirty) {
      if (diskHash !== null && diskHash === hashes.get(path)) {
        conflicts.delete(path);
        return 'keep';
      }
      if (dirty || diskHash === null) {
        conflicts.add(path);
        return 'conflict';
      }
      return 'reload';
    },
  };
}

/**
 * Re-reads every open tab after a change in the plugin folder: clean tabs with new content on disk are
 * reloaded, tabs with unsaved edits (or a file gone from disk) are marked.
 * @param {{ paths: string[], state: object, read(path): Promise<{ content: string, hash: string }>,
 *   isDirty(path): boolean, reload(path, content): void }} options
 */
export async function syncTabs({ paths, state, read, isDirty, reload }) {
  for (const path of paths) {
    let file = null;
    try { file = await read(path); } catch { file = null; }
    // isDirty is asked after the read: edits typed meanwhile must not be replaced
    const action = state.compare(path, file ? file.hash : null, isDirty(path));
    if (action === 'reload') {
      reload(path, file.content);
      state.track(path, file.hash);
    }
  }
}

/**
 * Loads the disk state into the open tabs of files the studio AI wrote or restored. A file gone from
 * disk (404, removed by undo) closes its tab; any other read error keeps the tab as it is.
 * @param {{ paths: string[], state: object, read(path): Promise<{ content: string, hash: string }>,
 *   reload(path, content): void, close(path): Promise<void> }} options
 * @returns {Promise<Array<{ path: string, message: string }>>} -> The files that could not be read.
 */
export async function reloadTabs({ paths, state, read, reload, close }) {
  const failed = [];
  for (const path of paths) {
    let file;
    try {
      file = await read(path);
    } catch (err) {
      if (err && err.status === 404) await close(path);
      else failed.push({ path, message: err && err.message ? err.message : String(err) });
      continue;
    }
    reload(path, file.content);
    state.track(path, file.hash);
  }
  return failed;
}

/**
 * Saves a tab against its base hash. When the file changed on disk (409) `askConflict(path)` decides:
 * 'reload' (drop the local edits, load the disk), 'overwrite' (save without base hash) or anything else (cancel).
 * @returns {Promise<'saved'|'reloaded'|'cancelled'>}
 */
export async function saveTab({ path, content, state, save, read, reload, askConflict }) {
  try {
    const { hash } = await save(path, content, state.hash(path));
    state.track(path, hash);
    return 'saved';
  } catch (err) {
    if (!err || err.status !== 409) throw err;
  }
  const choice = await askConflict(path);
  if (choice === 'overwrite') {
    const { hash } = await save(path, content);
    state.track(path, hash);
    return 'saved';
  }
  if (choice === 'reload') {
    const file = await read(path);
    reload(path, file.content);
    state.track(path, file.hash);
    return 'reloaded';
  }
  return 'cancelled';
}
