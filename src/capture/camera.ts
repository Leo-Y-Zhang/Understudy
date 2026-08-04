// Thin wrapper around getUserMedia. No auto-start anywhere: start() must
// only be invoked from an explicit user gesture (a button click), since
// mediaDevices.getUserMedia requires (and browsers enforce) a user gesture
// and will otherwise sit behind a permission prompt the user never asked
// for. The consent screen that owns this button lands in T14; here it's the
// dev HUD's "Start camera" button.

export class Camera {
  private stream: MediaStream | null = null;

  async start(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this.stream = stream;
    return stream;
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
