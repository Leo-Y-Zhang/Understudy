// Local, on-device session history. Raw promise-wrapped IndexedDB, no
// dependency -- two object stores in one database:
//   - `sessions` -- small JSON metrics/scoring records, keyPath `id`.
//   - `replays`  -- the optional recorded video blob for a session, keyPath
//                   `id`, the same id as its owning session.
// Splitting them means listSessions()/exportJson() never touch blob data at
// all (metrics-only, by construction, not by filtering), and a session can
// exist with or without a saved replay independently -- `hasReplay` on the
// record is the UI's source of truth for "does this session have a video",
// while the actual presence of a `replays` row is what deleteSession,
// setSessionReplay and wipeAll act on.
//
// A single connection is opened once and shared by every caller (module-
// level cache) -- fine here since the schema never needs a version bump
// mid-session and IndexedDB connections are cheap to hold open for a tab's
// lifetime.

import type { DeliveryEvent, SessionStats, SubScores } from '../core/types';

const DB_NAME = 'understudy';
const DB_VERSION = 1;
const SESSIONS_STORE = 'sessions';
const REPLAYS_STORE = 'replays';

export interface SessionRecord {
  id: string;
  startedAt: number; // Date.now() ms, when the recording began
  packId: string;
  questionId: string;
  questionText: string;
  durationS: number;
  stats: SessionStats;
  sub: SubScores;
  composure: number;
  events: DeliveryEvent[];
  hasReplay: boolean;
}

interface ReplayRow {
  id: string;
  blob: Blob;
}

export interface UnderstudyDb {
  saveSession(rec: SessionRecord): Promise<string>;
  listSessions(): Promise<SessionRecord[]>;
  saveReplay(id: string, blob: Blob): Promise<void>;
  getReplay(id: string): Promise<Blob | null>;
  /** Sets or clears a session's replay and its `hasReplay` flag in a single
   *  readwrite transaction over both stores, so a mid-write failure can
   *  never leave an orphaned blob (no matching `hasReplay: true`) or a
   *  dangling `hasReplay: true` (no matching blob) -- the two used to be
   *  separate transactions (`saveReplay`/`deleteReplay` + a follow-up
   *  `saveSession`) via replay.ts's "keep video" toggle; this replaces both.
   *  `blob` given: put the blob in `replays` and put `{...rec, hasReplay:
   *  true}` in `sessions`. `blob` null: delete the `replays` row and put
   *  `{...rec, hasReplay: false}` in `sessions`. */
  setSessionReplay(rec: SessionRecord, blob: Blob | null): Promise<void>;
  deleteSession(id: string): Promise<void>;
  wipeAll(): Promise<void>;
  exportJson(): Promise<string>;
}

let rawDbPromise: Promise<IDBDatabase> | null = null;

function openRawDb(): Promise<IDBDatabase> {
  if (!rawDbPromise) {
    rawDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const raw = req.result;
        if (!raw.objectStoreNames.contains(SESSIONS_STORE)) {
          raw.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
        }
        if (!raw.objectStoreNames.contains(REPLAYS_STORE)) {
          raw.createObjectStore(REPLAYS_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Failed to open the understudy database'));
    });
  }
  return rawDbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** Resolves once every request on `tx` has committed; rejects on abort/error
 *  (a failed request aborts its transaction, so this is the one place that
 *  needs to be awaited -- individual `put`/`delete`/`clear` calls below are
 *  fire-and-forget against the transaction itself). */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Opens (or reuses) the single shared connection to the `understudy`
 * database and returns the small promise-based API every screen uses.
 * Safe to call from more than one screen/module -- every caller shares the
 * same underlying `IDBDatabase` connection.
 */
export async function openDb(): Promise<UnderstudyDb> {
  const db = await openRawDb();

  const listSessions = async (): Promise<SessionRecord[]> => {
    const tx = db.transaction(SESSIONS_STORE, 'readonly');
    const all = await requestToPromise<SessionRecord[]>(tx.objectStore(SESSIONS_STORE).getAll());
    await txDone(tx);
    return all.slice().sort((a, b) => b.startedAt - a.startedAt);
  };

  const saveSession = async (rec: SessionRecord): Promise<string> => {
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    tx.objectStore(SESSIONS_STORE).put(rec);
    await txDone(tx);
    return rec.id;
  };

  const saveReplay = async (id: string, blob: Blob): Promise<void> => {
    const tx = db.transaction(REPLAYS_STORE, 'readwrite');
    const row: ReplayRow = { id, blob };
    tx.objectStore(REPLAYS_STORE).put(row);
    await txDone(tx);
  };

  const getReplay = async (id: string): Promise<Blob | null> => {
    const tx = db.transaction(REPLAYS_STORE, 'readonly');
    const row = await requestToPromise<ReplayRow | undefined>(tx.objectStore(REPLAYS_STORE).get(id));
    await txDone(tx);
    return row?.blob ?? null;
  };

  const setSessionReplay = async (rec: SessionRecord, blob: Blob | null): Promise<void> => {
    const tx = db.transaction([SESSIONS_STORE, REPLAYS_STORE], 'readwrite');
    if (blob) {
      const row: ReplayRow = { id: rec.id, blob };
      tx.objectStore(REPLAYS_STORE).put(row);
      tx.objectStore(SESSIONS_STORE).put({ ...rec, hasReplay: true });
    } else {
      tx.objectStore(REPLAYS_STORE).delete(rec.id);
      tx.objectStore(SESSIONS_STORE).put({ ...rec, hasReplay: false });
    }
    await txDone(tx);
  };

  const deleteSession = async (id: string): Promise<void> => {
    const tx = db.transaction([SESSIONS_STORE, REPLAYS_STORE], 'readwrite');
    tx.objectStore(SESSIONS_STORE).delete(id);
    tx.objectStore(REPLAYS_STORE).delete(id);
    await txDone(tx);
  };

  const wipeAll = async (): Promise<void> => {
    const tx = db.transaction([SESSIONS_STORE, REPLAYS_STORE], 'readwrite');
    tx.objectStore(SESSIONS_STORE).clear();
    tx.objectStore(REPLAYS_STORE).clear();
    await txDone(tx);
  };

  const exportJson = async (): Promise<string> => {
    // listSessions() already returns SessionRecord[] -- metrics/scoring
    // fields only, no blob ever touches this path -- so there is nothing to
    // strip here; the shape itself is the guarantee.
    const sessions = await listSessions();
    return JSON.stringify(sessions, null, 2);
  };

  return { saveSession, listSessions, saveReplay, getReplay, setSessionReplay, deleteSession, wipeAll, exportJson };
}
