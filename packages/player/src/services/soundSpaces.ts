/**
 * Offline procedural Web Audio ambient soundscapes (Rain, Vinyl Crackle, Fireplace)
 * that layer softly underneath music playback with zero external audio files.
 */

export type AmbientSpace = 'off' | 'rain' | 'vinyl' | 'fireplace';

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let activeSource: AudioBufferSourceNode | null = null;
let activeLfo: OscillatorNode | null = null;
let currentMode: AmbientSpace = 'off';

const createNoiseBuffer = (
  audioCtx: AudioContext,
  mode: Exclude<AmbientSpace, 'off'>,
): AudioBuffer => {
  const sampleRate = audioCtx.sampleRate;
  const length = sampleRate * 4; // 4-second seamless loop
  const buffer = audioCtx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    let lastOut = 0;

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      if (mode === 'rain') {
        // Pink noise for natural rainfall texture
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.06;
        b6 = white * 0.115926;
        data[i] = pink;
      } else if (mode === 'vinyl') {
        // Warm low hiss + occasional crisp vinyl dust pops
        lastOut = (lastOut + 0.04 * white) / 1.04;
        let sample = lastOut * 0.25;
        if (Math.random() < 0.00055) {
          sample += (Math.random() * 2 - 1) * 0.65;
        }
        data[i] = sample;
      } else {
        // Fireplace: deep brown rumble + warm wood crackles
        lastOut = (lastOut + 0.02 * white) / 1.02;
        let sample = lastOut * 1.4;
        if (Math.random() < 0.00035) {
          sample += (Math.random() * 2 - 1) * 0.75;
        }
        data[i] = Math.max(-1, Math.min(1, sample * 0.45));
      }
    }
  }
  return buffer;
};

const stopActiveNodes = () => {
  try {
    activeSource?.stop();
    activeSource?.disconnect();
  } catch {
    // ignore
  }
  try {
    activeLfo?.stop();
    activeLfo?.disconnect();
  } catch {
    // ignore
  }
  activeSource = null;
  activeLfo = null;
};

export const syncAmbientSoundSpace = (mode: AmbientSpace, volume: number) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (mode === 'off' || volume <= 0.001) {
    stopActiveNodes();
    currentMode = 'off';
    if (ctx && ctx.state === 'running') {
      void ctx.suspend();
    }
    return;
  }

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) {
    return;
  }

  if (!ctx) {
    ctx = new AudioCtx();
    masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }

  if (masterGain) {
    masterGain.gain.setTargetAtTime(volume * 0.55, ctx.currentTime, 0.08);
  }

  if (currentMode === mode && activeSource) {
    return;
  }

  stopActiveNodes();
  currentMode = mode;

  const source = ctx.createBufferSource();
  source.buffer = createNoiseBuffer(ctx, mode);
  source.loop = true;

  const filter = ctx.createBiquadFilter();
  if (mode === 'rain') {
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    filter.Q.value = 0.55;
  } else if (mode === 'vinyl') {
    filter.type = 'highpass';
    filter.frequency.value = 320;
  } else {
    filter.type = 'lowpass';
    filter.frequency.value = 520;
  }

  const modGain = ctx.createGain();
  modGain.gain.value = 1;

  if (mode === 'rain' || mode === 'fireplace') {
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = mode === 'rain' ? 0.14 : 0.35;
    lfoDepth.gain.value = mode === 'rain' ? 0.14 : 0.22;
    lfo.connect(lfoDepth);
    lfoDepth.connect(modGain.gain);
    lfo.start();
    activeLfo = lfo;
  }

  source.connect(filter);
  filter.connect(modGain);
  if (masterGain) {
    modGain.connect(masterGain);
  }
  source.start();
  activeSource = source;
};
