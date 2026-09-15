export function generateRadioStatic(durationMs: number): Uint8Array {
  const numSamples = Math.floor((24000 * durationMs) / 1000);
  const buffer = new Uint8Array(numSamples * 2);
  const view = new DataView(buffer.buffer);
  for (let i = 0; i < numSamples; i++) {
    const t = i / numSamples;
    let env = 1.0;
    if (t < 0.3) env = t / 0.3;
    else if (t > 0.7) env = (1.0 - t) / 0.3;
    const sample = Math.floor((Math.random() * 2 - 1) * 32767 * 0.18 * env);
    view.setInt16(i * 2, sample, true);
  }
  return buffer;
}
