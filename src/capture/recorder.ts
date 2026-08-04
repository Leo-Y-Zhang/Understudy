// MediaRecorder wrapper: records the camera+mic stream to a webm Blob, and
// on stop() also decodes the recorded audio and resamples it to 16 kHz mono
// (the shape downstream ASR/transformers.js work expects).

const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

const TARGET_SAMPLE_RATE = 16000;

function pickMimeType(): string {
  return MIME_CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
}

export class Recorder {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';

  start(stream: MediaStream): void {
    if (this.mediaRecorder) throw new Error('Recorder already started');

    this.mimeType = pickMimeType();
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
    this.mediaRecorder.ondataavailable = (ev: BlobEvent): void => {
      if (ev.data.size > 0) this.chunks.push(ev.data);
    };
    this.mediaRecorder.start();
  }

  async stop(): Promise<{ blob: Blob; audio16k: Float32Array }> {
    const recorder = this.mediaRecorder;
    if (!recorder) {
      throw new Error('Recorder.stop() called before start()');
    }

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    const blob = new Blob(this.chunks, { type: this.mimeType || 'video/webm' });
    const audio16k = await decodeAndResampleTo16kMono(blob);

    this.mediaRecorder = null;
    this.chunks = [];

    return { blob, audio16k };
  }
}

async function decodeAndResampleTo16kMono(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();

  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    void decodeCtx.close();
  }

  const targetLength = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();

  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}
