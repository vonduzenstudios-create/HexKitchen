// Web Worker: renders speech off the main thread. Message in: { id, text, opts }; out: { id, samples, sampleRate } | { id, error }.
import { renderSpeech, type SpeechOpts } from './render';

interface Req { id: number; text: string; opts: SpeechOpts }
const scope = self as unknown as { onmessage: ((e: MessageEvent<Req>) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };
scope.onmessage = (e: MessageEvent<Req>) => {
  const { id, text, opts } = e.data;
  try {
    const r = renderSpeech(text, opts);
    scope.postMessage({ id, samples: r.samples, sampleRate: r.sampleRate }, [r.samples.buffer]);
  } catch (err) {
    scope.postMessage({ id, error: String(err) });
  }
};
