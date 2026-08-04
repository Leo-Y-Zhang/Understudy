// db.ts persistence tests, against fake-indexeddb (no real browser needed).
// `fake-indexeddb/auto` installs `indexedDB`/`IDBKeyRange` etc as globals
// before anything else in this file runs, so `openDb()` sees a real-shaped
// IndexedDB implementation. `openDb()` caches a single connection at module
// scope (by design -- see db.ts), so every test starts from a clean slate by
// calling `wipeAll()` itself in `beforeEach` rather than assuming isolation
// between tests or files.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type SessionRecord } from '../../src/data/db';
import type { DeliveryEvent, SessionStats, SubScores } from '../../src/core/types';

function mkStats(overrides: Partial<SessionStats> = {}): SessionStats {
  return {
    durationS: 62,
    eyeContactPct: 78,
    blinksPerMin: 16,
    wpm: 132,
    paceCv: 0.18,
    fillerCount: 2,
    pauseCount: 1,
    fidgetIndex: 0.12,
    wordCount: 141,
    ...overrides,
  };
}

function mkSub(overrides: Partial<SubScores> = {}): SubScores {
  return {
    eyeContact: 80,
    blinkSteadiness: 75,
    expressionControl: 70,
    headSteadiness: 85,
    pace: 90,
    fluency: 88,
    ...overrides,
  };
}

function mkEvents(): DeliveryEvent[] {
  return [{ t0: 1, t1: 2, type: 'pause', severity: 1, detail: 'pause 1.0s' }];
}

function mkRecord(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'unset-id',
    startedAt: Date.now(),
    packId: 'general-admissions',
    questionId: 'q1',
    questionText: 'Tell me about a time you led a project.',
    durationS: 62,
    stats: mkStats(),
    sub: mkSub(),
    composure: 72.4,
    events: mkEvents(),
    hasReplay: false,
    ...overrides,
  };
}

describe('db', () => {
  beforeEach(async () => {
    const db = await openDb();
    await db.wipeAll();
  });

  it('round-trips save -> list and sorts newest-first by startedAt', async () => {
    const db = await openDb();
    const a = mkRecord({ id: 'a', startedAt: 1000 });
    const b = mkRecord({ id: 'b', startedAt: 3000 });
    const c = mkRecord({ id: 'c', startedAt: 2000 });

    // Insert deliberately out of chronological order.
    await db.saveSession(a);
    await db.saveSession(b);
    await db.saveSession(c);

    const list = await db.listSessions();
    expect(list.map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(list[0]).toEqual(b);
    expect(list[0]!.stats).toEqual(mkStats());
    expect(list[0]!.sub).toEqual(mkSub());
  });

  it('saveSession returns the record id', async () => {
    const db = await openDb();
    const rec = mkRecord({ id: 'return-id' });
    await expect(db.saveSession(rec)).resolves.toBe('return-id');
  });

  it('exportJson contains stats and composure but no blob data, and parses as JSON', async () => {
    const db = await openDb();
    const rec = mkRecord({ id: 'x', hasReplay: true });
    await db.saveSession(rec);
    await db.saveReplay('x', new Blob(['not-real-video-bytes'], { type: 'video/webm' }));

    const json = await db.exportJson();
    expect(() => JSON.parse(json)).not.toThrow();

    const parsed = JSON.parse(json) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);

    const entry = parsed[0] as Record<string, unknown>;
    expect(entry.id).toBe('x');
    expect(entry.composure).toBe(72.4);
    expect(entry.stats).toEqual(mkStats());
    expect(entry.sub).toEqual(mkSub());
    expect(entry.hasReplay).toBe(true);
    expect(entry).not.toHaveProperty('blob');
    expect(entry).not.toHaveProperty('replayBlob');
    expect(json).not.toContain('not-real-video-bytes');
  });

  it('wipeAll empties both the sessions and replays stores', async () => {
    const db = await openDb();
    await db.saveSession(mkRecord({ id: 'y', hasReplay: true }));
    await db.saveReplay('y', new Blob(['bytes']));
    expect(await db.listSessions()).toHaveLength(1);
    expect(await db.getReplay('y')).not.toBeNull();

    await db.wipeAll();

    expect(await db.listSessions()).toEqual([]);
    expect(await db.getReplay('y')).toBeNull();
  });

  it('deleteSession removes the session and cascades to its replay', async () => {
    const db = await openDb();
    await db.saveSession(mkRecord({ id: 'z', hasReplay: true }));
    await db.saveReplay('z', new Blob(['bytes']));

    await db.deleteSession('z');

    expect(await db.listSessions()).toEqual([]);
    expect(await db.getReplay('z')).toBeNull();
  });

  it('deleteSession on an id with no saved replay does not throw', async () => {
    const db = await openDb();
    await db.saveSession(mkRecord({ id: 'no-replay' }));
    await expect(db.deleteSession('no-replay')).resolves.toBeUndefined();
    expect(await db.listSessions()).toEqual([]);
  });

  it('getReplay resolves null for a missing id', async () => {
    const db = await openDb();
    expect(await db.getReplay('does-not-exist')).toBeNull();
  });

  it('deleteReplay clears the video but leaves the session record intact', async () => {
    const db = await openDb();
    const rec = mkRecord({ id: 'keep-session', hasReplay: true });
    await db.saveSession(rec);
    await db.saveReplay('keep-session', new Blob(['bytes']));

    await db.deleteReplay('keep-session');

    expect(await db.getReplay('keep-session')).toBeNull();
    const list = await db.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('keep-session');
  });
});
