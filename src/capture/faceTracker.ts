// Wraps @mediapipe/tasks-vision's FaceLandmarker to drive per-frame
// FaceSample callbacks off a live <video> element.
//
// API surface verified against the installed 1.0.1 package (this repo pins
// 1.0.1, a major ahead of the older FilesetResolver/FaceLandmarker docs
// floating around) -- see node_modules/@mediapipe/tasks-vision/vision.d.ts:
//   - FilesetResolver.forVisionTasks(basePath?, useModule?) -> Promise<WasmFileset>  (line ~792)
//   - FaceLandmarker.createFromOptions(wasmFileset, options) -> Promise<FaceLandmarker>  (line 555)
//   - FaceLandmarkerOptions extends VisionTaskOptions { baseOptions, runningMode,
//       numFaces, minFaceDetectionConfidence, minFacePresenceConfidence,
//       minTrackingConfidence, outputFaceBlendshapes,
//       outputFacialTransformationMatrixes }  (line 676)
//   - detectForVideo(videoFrame, timestampMs, imageProcessingOptions?) -> FaceLandmarkerResult
//     -- synchronous, NOT a Promise (line 672)
//   - FaceLandmarkerResult { faceLandmarks: NormalizedLandmark[][];
//       faceBlendshapes: Classifications[]; facialTransformationMatrixes: Matrix[] }
//     (line 714) -- structurally compatible with facemath's
//     FaceLandmarkerResultLike, so toFaceSample() can consume it directly.
// This matches the shape the task brief expected; no adaptation needed.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { FaceSample } from '../core/types';
import { toFaceSample } from './facemath';

// WasmFileset isn't exported by name from the package (it's an unexported
// `declare interface` in vision.d.ts, only reachable structurally), so
// derive its type from the function that produces it instead of importing it.
type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

const WASM_BASE_PATH = './mediapipe/wasm';
const MODEL_ASSET_PATH = './mediapipe/face_landmarker.task';

// Log every LOG_EVERY_N samples so a HUD/probe watching the console can
// confirm samples are actually flowing (and at roughly what rate).
const LOG_EVERY_N = 30;

export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private rvfcHandle: number | null = null;
  private startTime = 0;
  private running = false;
  private sampleCount = 0;
  private presentCount = 0;

  async start(video: HTMLVideoElement, onSample: (s: FaceSample) => void): Promise<void> {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
    this.landmarker = await this.createLandmarker(vision);
    this.video = video;
    this.startTime = performance.now();
    this.running = true;
    this.sampleCount = 0;
    this.presentCount = 0;

    console.log('[faceTracker] tracker-initialized');

    const loop = (): void => {
      if (!this.running || !this.landmarker || !this.video) return;

      const nowMs = performance.now();
      const t = (nowMs - this.startTime) / 1000;
      const result = this.landmarker.detectForVideo(this.video, nowMs);
      const sample = toFaceSample(t, result);

      this.sampleCount += 1;
      if (sample.present) this.presentCount += 1;
      if (this.sampleCount % LOG_EVERY_N === 0) {
        const presentRatio = this.presentCount / this.sampleCount;
        console.log(
          `[faceTracker] samples-flowing count=${this.sampleCount} presentRatio=${presentRatio.toFixed(2)}`
        );
      }

      onSample(sample);

      this.rvfcHandle = this.video.requestVideoFrameCallback(loop);
    };

    this.rvfcHandle = video.requestVideoFrameCallback(loop);
  }

  stop(): void {
    this.running = false;
    if (this.video && this.rvfcHandle !== null) {
      this.video.cancelVideoFrameCallback(this.rvfcHandle);
    }
    this.rvfcHandle = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.video = null;
  }

  private async createLandmarker(vision: WasmFileset): Promise<FaceLandmarker> {
    const options = {
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    };
    try {
      return await FaceLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: MODEL_ASSET_PATH, delegate: 'GPU' },
      });
    } catch (err) {
      console.warn('[faceTracker] GPU delegate failed, falling back to CPU', err);
      return FaceLandmarker.createFromOptions(vision, {
        ...options,
        baseOptions: { modelAssetPath: MODEL_ASSET_PATH, delegate: 'CPU' },
      });
    }
  }
}
