let audioReady = false;
let audioCtx = null;
let ctxMasterGain = null;

function ensureCtx() {
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  ctxMasterGain = audioCtx.createGain();
  ctxMasterGain.gain.value = 0.6;
  ctxMasterGain.connect(audioCtx.destination);
  return audioCtx;
}

export function initAudio() {
  if (audioReady) return;
  ensureCtx();
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  audioReady = true;
}

function scheduleTone({ freq, type = 'triangle', start = 0, peak = 0.18, attack = 0.005, duration = 0.18, freqEnd = null }) {
  const ctx = ensureCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now + start);
  if (freqEnd != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), now + start + duration);
  }
  gain.gain.setValueAtTime(0, now + start);
  gain.gain.linearRampToValueAtTime(peak, now + start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
  osc.connect(gain);
  gain.connect(ctxMasterGain);
  osc.start(now + start);
  osc.stop(now + start + duration + 0.02);
}

export function playSnapSound(isExpanding) {
  if (isExpanding) {
    scheduleTone({ freq: 880, type: 'triangle', start: 0.0, peak: 0.22, attack: 0.002, duration: 0.07 });
    scheduleTone({ freq: 1760, type: 'square', start: 0.005, peak: 0.08, attack: 0.001, duration: 0.03, freqEnd: 1200 });
  } else {
    scheduleTone({ freq: 1320, type: 'triangle', start: 0.0, peak: 0.22, attack: 0.002, duration: 0.06, freqEnd: 880 });
    scheduleTone({ freq: 660, type: 'square', start: 0.0, peak: 0.08, attack: 0.001, duration: 0.025, freqEnd: 440 });
  }
}

export function playReminderTone() {
  scheduleTone({ freq: 880, type: 'sine', start: 0.0, peak: 0.22, attack: 0.005, duration: 0.6 });
  scheduleTone({ freq: 1320, type: 'sine', start: 0.18, peak: 0.18, attack: 0.005, duration: 0.4 });
}

export function playTaskCreateSound() {
  scheduleTone({ freq: 660, type: 'triangle', start: 0.0, peak: 0.22, attack: 0.003, duration: 0.09, freqEnd: 990 });
  scheduleTone({ freq: 1320, type: 'sine', start: 0.04, peak: 0.16, attack: 0.003, duration: 0.12 });
}

export function playTaskDeleteSound() {
  scheduleTone({ freq: 990, type: 'triangle', start: 0.0, peak: 0.22, attack: 0.003, duration: 0.07, freqEnd: 660 });
  scheduleTone({ freq: 495, type: 'sine', start: 0.025, peak: 0.14, attack: 0.003, duration: 0.09 });
}

export function playFallbackDeleteSound() {
  scheduleTone({ freq: 220, type: 'square', start: 0.0, peak: 0.16, attack: 0.002, duration: 0.08, freqEnd: 110 });
}

export function playTimesUpSound() {
  for (let i = 0; i < 3; i++) {
    scheduleTone({ freq: 1000, type: 'square', start: 0.0 + i * 0.18, peak: 0.22, attack: 0.002, duration: 0.13 });
    scheduleTone({ freq: 1300, type: 'sine', start: 0.0 + i * 0.18, peak: 0.14, attack: 0.002, duration: 0.16 });
  }
}

export function playVictorySound() {
  scheduleTone({ freq: 523.25, type: 'triangle', start: 0.0,  peak: 0.22, attack: 0.005, duration: 0.15 });
  scheduleTone({ freq: 659.25, type: 'triangle', start: 0.04, peak: 0.22, attack: 0.005, duration: 0.15 });
  scheduleTone({ freq: 783.99, type: 'triangle', start: 0.08, peak: 0.22, attack: 0.005, duration: 0.15 });
  scheduleTone({ freq: 1046.50, type: 'triangle', start: 0.12, peak: 0.26, attack: 0.005, duration: 0.5 });
}
