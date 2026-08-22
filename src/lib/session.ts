const KEY = 'hx.sessionId';

/** Stable per-browser id, generated once and reused across reloads — sent as
 *  `?session=` on every mesh/solve/report request so this browser's case
 *  directory never collides with another one hitting the same backend (see
 *  backend/app/services/job_state.py). Not a security boundary, just isolation. */
export function getSessionId(): string {
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}
