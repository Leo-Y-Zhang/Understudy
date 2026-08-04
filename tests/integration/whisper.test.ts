// Local-only integration test for the Whisper transcription pipeline
// (src/speech/asr.ts). Excluded from CI by directory: `npm run test:unit`
// only runs `--dir tests/unit`; this suite runs separately via
// `npm run test:integration` (`vitest run --dir tests/integration`), which
// nothing in .github/workflows/ci.yml invokes.
//
// Runs the *real* pipeline in Node against the vendored model at
// public/models/ -- no mocks, no network (env.allowRemoteModels = false is
// set inside createTranscriber()). `createTranscriber('public/models/')`
// passes a path relative to the repo root because vitest's cwd is the repo
// root when `npm run test:integration` is invoked from there, and Node's
// `fs.existsSync()` (used by FileResponse, see asr.ts's header for the
// getFile() -> FileResponse citation trail) resolves relative paths against
// `process.cwd()`.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTranscriber } from '../../src/speech/asr';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(TEST_DIR, 'fixtures', 'spoken.wav');
const MODEL_PATH = 'public/models/';

// At least this many of these should show up in the lowercased transcript --
// a loose content check that tolerates whisper-tiny.en's occasional
// mis-transcriptions without requiring an exact match.
const CONTENT_WORDS = ['hello', 'plants', 'light', 'energy', 'answer'];

const MIN_WORDS = 8;
const MIN_CONTENT_HITS = 3;
const TIMEOUT_MS = 300_000;

interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  samples: Float32Array;
}

/** Hand-rolled minimal WAV parser: PCM16 -> Float32Array (mono-downmixed, /32768). */
function parseWav(buf: Buffer): ParsedWav {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('parseWav: not a RIFF/WAVE file');
  }

  let offset = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataStart = -1;
  let dataLength = 0;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(bodyStart),
        channels: buf.readUInt16LE(bodyStart + 2),
        sampleRate: buf.readUInt32LE(bodyStart + 4),
        bitsPerSample: buf.readUInt16LE(bodyStart + 14),
      };
    } else if (chunkId === 'data') {
      dataStart = bodyStart;
      dataLength = chunkSize;
    }

    // Chunks are word-aligned: an odd-sized chunk body is followed by one
    // pad byte not counted in chunkSize.
    offset = bodyStart + chunkSize + (chunkSize % 2);
  }

  if (!fmt) throw new Error('parseWav: missing fmt chunk');
  if (dataStart < 0) throw new Error('parseWav: missing data chunk');
  if (fmt.audioFormat !== 1) throw new Error(`parseWav: expected PCM (1), got audioFormat ${fmt.audioFormat}`);
  if (fmt.bitsPerSample !== 16) throw new Error(`parseWav: expected 16-bit PCM, got ${fmt.bitsPerSample}-bit`);

  const frameCount = Math.floor(dataLength / 2 / fmt.channels);
  const samples = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      sum += buf.readInt16LE(dataStart + (i * fmt.channels + c) * 2);
    }
    samples[i] = sum / fmt.channels / 32768;
  }

  return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample, samples };
}

describe('whisper integration (local model, real inference)', () => {
  it(
    'transcribes the SAPI fixture into plausible words with sane timestamps',
    async () => {
      const wavBuf = readFileSync(FIXTURE_PATH);
      const wav = parseWav(wavBuf);
      expect(wav.sampleRate).toBe(16000);
      expect(wav.channels).toBe(1);

      const transcribe = await createTranscriber(MODEL_PATH);

      const progressEvents: number[] = [];
      const start = performance.now();
      const words = await transcribe(wav.samples, (p) => progressEvents.push(p));
      const elapsedMs = performance.now() - start;

      const transcript = words.map((w) => w.text).join(' ');
      console.log(`[whisper.test] transcribed ${words.length} words in ${elapsedMs.toFixed(0)}ms`);
      console.log(`[whisper.test] progress events: ${progressEvents.length}`);
      console.log(`[whisper.test] transcript: "${transcript}"`);

      expect(words.length).toBeGreaterThanOrEqual(MIN_WORDS);

      const audioDurationS = wav.samples.length / wav.sampleRate;
      let prevT0 = 0;
      for (const w of words) {
        expect(w.t0).toBeGreaterThanOrEqual(prevT0);
        expect(w.t1).toBeGreaterThanOrEqual(w.t0);
        prevT0 = w.t0;
      }
      const lastWord = words[words.length - 1];
      if (!lastWord) throw new Error('expected at least one word (checked above via MIN_WORDS)');
      expect(lastWord.t1).toBeLessThanOrEqual(audioDurationS + 0.5);

      const lowerTranscript = transcript.toLowerCase();
      const hits = CONTENT_WORDS.filter((w) => lowerTranscript.includes(w));
      console.log(`[whisper.test] content-word hits: [${hits.join(', ')}] (${hits.length}/${CONTENT_WORDS.length})`);
      expect(hits.length).toBeGreaterThanOrEqual(MIN_CONTENT_HITS);

      // Logged only, not asserted: whisper-tiny.en + a synthetic SAPI voice
      // may well drop "um" filler tokens entirely (that's exactly the kind
      // of case the filler-detection heuristic layer is unit-tested
      // against separately, with controlled input -- this integration test
      // only proves the real pipeline runs end to end).
      const hasUm = /\bum\b/.test(lowerTranscript);
      console.log(`[whisper.test] 'um' present in transcript: ${hasUm} (not asserted)`);
    },
    TIMEOUT_MS
  );
});
