import { buildProjectFile, projectFileToPatch, type ProjectFile, type ProjectSourceState } from './projectFile';

const KEY = 'hx.autosave.v1';

/** Continuously-updated local session state — separate from the portable, shareable
 *  .hxproj.json (see projectFile.ts): this also remembers which workflow step the user
 *  was on, since it's the same browser picking back up, not someone else's file. */
export function saveAutosave(state: ProjectSourceState & { step: number }): void {
  try {
    const project = buildProjectFile(state);
    window.localStorage.setItem(KEY, JSON.stringify({ ...project, step: state.step }));
  } catch {
    // localStorage full or unavailable (private browsing) — autosave is a convenience
    // on top of the real, explicit Save/Load-to-disk flow, never load-bearing.
  }
}

/** Returns a store patch to restore the last session, or null if there isn't one
 *  (first run, cleared, or the saved JSON doesn't parse). */
export function loadAutosave(): (ReturnType<typeof projectFileToPatch> & { step: number }) | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as ProjectFile & { step: number };
    if (typeof data.schema !== 'number' || !data.geometry) return null;
    return { ...projectFileToPatch(data), step: typeof data.step === 'number' ? data.step : 0 };
  } catch {
    return null;
  }
}

export function clearAutosave(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
