export const reminderTone = new Audio('assets/due_reminder_tone.mp3');
reminderTone.preload = 'auto';

export const collapseExpandTone = new Audio('assets/collapse_expand_tone.mp3');
collapseExpandTone.preload = 'auto';

export const taskCreateTone = new Audio('assets/task_create_tone.mp3');
taskCreateTone.preload = 'auto';

export const taskActivationTone = new Audio('assets/task_activation.mp3');
taskActivationTone.preload = 'auto';

export const taskDeleteTone = new Audio('assets/task_delete_tone.mp3');
taskDeleteTone.preload = 'auto';

export const fallbackDeleteTone = new Audio('assets/fallback_delete_tone.mp3');
fallbackDeleteTone.preload = 'auto';

export const timesUpTone = new Audio('assets/times_up_tone.mp3');
timesUpTone.preload = 'auto';

export function playReminderTone() {
  reminderTone.currentTime = 0;
  reminderTone.play().catch(() => {});
}

export function playCollapseExpandSound() {
  collapseExpandTone.currentTime = 0;
  collapseExpandTone.play().catch(() => {});
}

export function playTaskCreateSound() {
  taskCreateTone.currentTime = 0;
  taskCreateTone.play().catch(() => {});
}

export function playTaskActivationSound() {
  taskActivationTone.currentTime = 0;
  taskActivationTone.play().catch(() => {});
}

export function playTaskDeleteSound() {
  taskDeleteTone.currentTime = 0;
  taskDeleteTone.play().catch(() => {});
}

export function playFallbackDeleteSound() {
  fallbackDeleteTone.currentTime = 0;
  fallbackDeleteTone.play().catch(() => {});
}

export function playTimesUpSound() {
  timesUpTone.currentTime = 0;
  timesUpTone.play().catch(() => {});
}

export function playVictorySound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();

  const playNote = (freq, startTime, duration) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startTime);

    gain.gain.setValueAtTime(0, ctx.currentTime + startTime);
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + startTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime + startTime);
    osc.stop(ctx.currentTime + startTime + duration);
  };

  // Triumphant fast arpeggio
  playNote(523.25, 0.0, 0.15); // C5
  playNote(659.25, 0.1, 0.15); // E5
  playNote(783.99, 0.2, 0.15); // G5
  playNote(1046.50, 0.3, 0.5); // C6
}
