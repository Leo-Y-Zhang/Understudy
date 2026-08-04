// AudioWorkletProcessor that accumulates RMS over fixed-size hops and posts
// each hop's value back to the owning AudioWorkletNode.
//
// This file runs in the AudioWorkletGlobalScope, not the window/DOM scope --
// there's no `document`, and the globals below (AudioWorkletProcessor,
// registerProcessor, sampleRate) come from a different lib than the rest of
// this project. TS's bundled DOM lib (this repo's tsconfig: ES2022 + DOM +
// DOM.Iterable + WebWorker) does not declare them -- there's no separate
// worklet tsconfig/lib here, so they're declared locally and kept unexported
// (module-local ambients) rather than polluting the global scope for every
// other file in the program.

declare const sampleRate: number;

interface RmsProcessorOptions {
  hopS?: number;
}

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: RmsProcessorOptions });
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: { processorOptions?: RmsProcessorOptions }) => AudioWorkletProcessor
): void;

const DEFAULT_HOP_S = 0.05;

class RmsProcessor extends AudioWorkletProcessor {
  private readonly hopSamples: number;
  private sumSquares = 0;
  private countInHop = 0;

  constructor(options?: { processorOptions?: RmsProcessorOptions }) {
    super(options);
    const hopS = options?.processorOptions?.hopS ?? DEFAULT_HOP_S;
    this.hopSamples = Math.max(1, Math.round(hopS * sampleRate));
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const v = channel[i] ?? 0;
        this.sumSquares += v * v;
        this.countInHop += 1;
        if (this.countInHop >= this.hopSamples) {
          this.port.postMessage(Math.sqrt(this.sumSquares / this.countInHop));
          this.sumSquares = 0;
          this.countInHop = 0;
        }
      }
    }
    // Keep the processor alive for the lifetime of the node.
    return true;
  }
}

registerProcessor('rms-processor', RmsProcessor);
