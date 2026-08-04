// Live RMS meter: AudioContext + AudioWorklet (rms-worklet.ts), collecting
// hop-sized RMS values into a growable series for post-session VAD/pace
// analysis, while also exposing the latest hop value for a live HUD meter.

import type { RmsSeries } from '../core/types';

// `new URL('./rms-worklet.ts', import.meta.url)` looked right (it's the
// pattern MDN/most tutorials show) but under `vite build` it does NOT run
// the file through Vite's TS/JS transform -- it just inlines the raw,
// untranspiled TypeScript source as a data: URL (verified by decoding the
// built dist/assets/index-*.js: the payload was literally the .ts source,
// `declare class` and all, which the browser can't parse as JS). The `dev`
// server happens to work because Vite serves .ts files transpiled on the
// fly regardless of how they're referenced, masking the bug.
//
// The `?worker&url` suffix (declared ambiently by vite/client, see
// node_modules/vite/client.d.ts) is Vite's documented way to get a URL to a
// *compiled* module bundle without Vite auto-instantiating a Worker from it
// -- exactly what AudioWorklet.addModule() needs. This one round-trips
// correctly through `npm run build && npm run preview` (verified).
import rmsWorkletUrl from './rms-worklet.ts?worker&url';

const HOP_S = 0.05;

export class AudioMeter {
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private silentGain: GainNode | null = null;
  private values: number[] = [];

  async start(stream: MediaStream): Promise<void> {
    const audioCtx = new AudioContext();

    await audioCtx.audioWorklet.addModule(rmsWorkletUrl);

    const workletNode = new AudioWorkletNode(audioCtx, 'rms-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { hopS: HOP_S },
    });
    workletNode.port.onmessage = (ev: MessageEvent<number>): void => {
      this.values.push(ev.data);
    };

    const sourceNode = audioCtx.createMediaStreamSource(stream);

    // AudioWorkletNode must be reachable from the destination for most
    // engines to actually pull/process it; route through a silent gain so
    // we get RMS ticks without echoing the mic back out.
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;

    sourceNode.connect(workletNode);
    workletNode.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    this.audioCtx = audioCtx;
    this.sourceNode = sourceNode;
    this.workletNode = workletNode;
    this.silentGain = silentGain;
    this.values = [];
  }

  /** Latest hop RMS value (0 if nothing has arrived yet). Dev-HUD only -- not part of T14's contract. */
  getLatestRms(): number {
    return this.values.length > 0 ? (this.values[this.values.length - 1] ?? 0) : 0;
  }

  stopAndGetSeries(): RmsSeries {
    this.sourceNode?.disconnect();
    this.workletNode?.disconnect();
    this.silentGain?.disconnect();
    void this.audioCtx?.close();

    const series: RmsSeries = { hopS: HOP_S, values: Float32Array.from(this.values) };

    this.audioCtx = null;
    this.sourceNode = null;
    this.workletNode = null;
    this.silentGain = null;
    this.values = [];

    return series;
  }
}
