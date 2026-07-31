//! Animated Dock icon (macOS only).
//!
//! Swaps the application's Dock icon between pre-rendered frames so the eyes
//! blink, glance around and occasionally roll. The frames are built ahead of
//! time by `scripts/build-dock-frames.mjs` and embedded with `include_bytes!`;
//! nothing here draws or generates an image at runtime.
//!
//! Everything is driven by coarse interval timers — a task sleeps for the whole
//! gap between animations rather than waking on a tick to check whether it is
//! time yet — and the Cocoa call is only made when the frame actually changes.
//!
//! If anything needed to get started is missing, the module returns quietly
//! without ever calling `setApplicationIconImage:`, leaving the Dock showing the
//! bundled `icon.icns`. There is no path here that produces a blank icon.
//!
//! This whole file is compiled only on macOS; see the `#[cfg]` on the `mod`
//! declaration in `lib.rs`.

use std::cell::RefCell;
use std::ops::Range;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use objc2::rc::Retained;
use objc2::{AnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::NSData;
use tauri::async_runtime::JoinHandle;
use tauri::AppHandle;

/// How long a closed-eye frame is held.
const BLINK_HOLD: Range<u64> = 120..180;
/// Gap between blinks.
const BLINK_GAP: Range<u64> = 4_000..9_000;
/// How long a glance is held before returning to idle.
const LOOK_HOLD: Range<u64> = 1_000..2_000;
/// Gap between glances.
const LOOK_GAP: Range<u64> = 6_000..14_000;
/// Time each frame of the roll is held.
const ROLL_STEP: Range<u64> = 100..150;
/// Gap between rolls.
const ROLL_GAP: Range<u64> = 90_000..240_000;

/// Set while the animation is live. Cleared on shutdown so a task that is
/// already awake stops before scheduling anything further.
static RUNNING: AtomicBool = AtomicBool::new(false);
/// The frame currently on the Dock, so a redundant swap can be skipped.
static CURRENT: AtomicU8 = AtomicU8::new(Frame::IdleCenter as u8);
/// Timer tasks, kept so they can be aborted on quit rather than left running.
static TASKS: Mutex<Vec<JoinHandle<()>>> = Mutex::new(Vec::new());

thread_local! {
    /// Decoded frames. `NSImage` is not `Send`, and every read happens on the
    /// main thread, so the cache lives there rather than in shared state.
    static IMAGES: RefCell<Vec<Retained<NSImage>>> = const { RefCell::new(Vec::new()) };
}

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum Frame {
    IdleCenter = 0,
    LookLeft,
    LookRight,
    LookUp,
    LookDown,
    Roll1,
    Roll2,
    Roll3,
    Roll4,
    Roll5,
    Roll6,
    Roll7,
    Roll8,
    BlinkClosed,
}

/// Frame payloads, in `Frame` discriminant order.
const FRAME_BYTES: [&[u8]; 14] = [
    include_bytes!("../assets/dock/idle-center.png"),
    include_bytes!("../assets/dock/look-left.png"),
    include_bytes!("../assets/dock/look-right.png"),
    include_bytes!("../assets/dock/look-up.png"),
    include_bytes!("../assets/dock/look-down.png"),
    include_bytes!("../assets/dock/roll-1.png"),
    include_bytes!("../assets/dock/roll-2.png"),
    include_bytes!("../assets/dock/roll-3.png"),
    include_bytes!("../assets/dock/roll-4.png"),
    include_bytes!("../assets/dock/roll-5.png"),
    include_bytes!("../assets/dock/roll-6.png"),
    include_bytes!("../assets/dock/roll-7.png"),
    include_bytes!("../assets/dock/roll-8.png"),
    include_bytes!("../assets/dock/blink-closed.png"),
];

// Frames are looked up by discriminant, so the table has to cover the enum.
const _: () = assert!(FRAME_BYTES.len() == Frame::BlinkClosed as usize + 1);

const LOOK_FRAMES: [Frame; 4] = [
    Frame::LookLeft,
    Frame::LookRight,
    Frame::LookUp,
    Frame::LookDown,
];

const ROLL_FRAMES: [Frame; 8] = [
    Frame::Roll1,
    Frame::Roll2,
    Frame::Roll3,
    Frame::Roll4,
    Frame::Roll5,
    Frame::Roll6,
    Frame::Roll7,
    Frame::Roll8,
];

impl Frame {
    fn from_index(index: u8) -> Self {
        match index {
            1 => Self::LookLeft,
            2 => Self::LookRight,
            3 => Self::LookUp,
            4 => Self::LookDown,
            5 => Self::Roll1,
            6 => Self::Roll2,
            7 => Self::Roll3,
            8 => Self::Roll4,
            9 => Self::Roll5,
            10 => Self::Roll6,
            11 => Self::Roll7,
            12 => Self::Roll8,
            13 => Self::BlinkClosed,
            _ => Self::IdleCenter,
        }
    }
}

/// xorshift64*, seeded from the clock. Only used to jitter animation timings,
/// which does not warrant pulling in a dependency.
struct Rng(u64);

impl Rng {
    fn new(salt: u64) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos() as u64)
            .unwrap_or(0x9E37_79B9_7F4A_7C15);
        // Never zero — xorshift is stuck there.
        Self(nanos.wrapping_add(salt.wrapping_mul(0x9E37_79B9_7F4A_7C15)) | 1)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn duration(&mut self, range: Range<u64>) -> Duration {
        let span = range.end.saturating_sub(range.start).max(1);
        Duration::from_millis(range.start + self.next() % span)
    }

    fn pick<T: Copy>(&mut self, options: &[T]) -> T {
        options[(self.next() % options.len() as u64) as usize]
    }
}

/// Decode every frame. Returns `None` if any of them fails, so the caller can
/// fall back to the bundled icon rather than animate a partial set.
fn decode_frames() -> Option<Vec<Retained<NSImage>>> {
    FRAME_BYTES
        .iter()
        .map(|bytes| {
            let data = NSData::with_bytes(bytes);
            // Returns nil rather than trapping on data it cannot decode, which
            // `collect` into `Option<Vec<_>>` turns into `None`.
            NSImage::initWithData(NSImage::alloc(), &data)
        })
        .collect()
}

/// Hand a frame to the Dock. Main thread only — `NSApplication` requires it.
fn apply(mtm: MainThreadMarker, frame: Frame) {
    IMAGES.with_borrow(|images| {
        if let Some(image) = images.get(frame as usize) {
            let app = NSApplication::sharedApplication(mtm);
            // SAFETY: called on the main thread, as witnessed by `mtm`, with an
            // image this module owns for the process's lifetime.
            unsafe { app.setApplicationIconImage(Some(image)) };
        }
    });
}

/// Show `frame`, unless it is already showing. Skipping the redundant call is
/// what keeps a held glance or a gap between blinks completely idle.
fn set_frame(app: &AppHandle, frame: Frame) {
    if CURRENT.swap(frame as u8, Ordering::Relaxed) == frame as u8 {
        return;
    }

    let _ = app.run_on_main_thread(move || {
        if let Some(mtm) = MainThreadMarker::new() {
            apply(mtm, frame);
        }
    });
}

/// Sleep, then report whether the animation is still meant to be running. A
/// `false` return means shutdown happened during the sleep, and the caller
/// should return without touching the icon again — the Dock has already been
/// handed back the bundled one.
async fn nap(duration: Duration) -> bool {
    tokio::time::sleep(duration).await;
    RUNNING.load(Ordering::Relaxed)
}

async fn blink(app: &AppHandle, rng: &mut Rng) {
    // Whatever was showing before, so a blink never changes where the eyes look.
    let previous = Frame::from_index(CURRENT.load(Ordering::Relaxed));
    set_frame(app, Frame::BlinkClosed);
    if nap(rng.duration(BLINK_HOLD)).await {
        set_frame(app, previous);
    }
}

async fn look(app: &AppHandle, rng: &mut Rng) {
    set_frame(app, rng.pick(&LOOK_FRAMES));
    if nap(rng.duration(LOOK_HOLD)).await {
        set_frame(app, Frame::IdleCenter);
    }
}

async fn roll(app: &AppHandle, rng: &mut Rng) {
    for frame in ROLL_FRAMES {
        set_frame(app, frame);
        if !nap(rng.duration(ROLL_STEP)).await {
            return;
        }
    }
    set_frame(app, Frame::IdleCenter);
}

#[derive(Clone, Copy)]
enum Animation {
    Blink,
    Look,
    Roll,
}

impl Animation {
    const ALL: [Self; 3] = [Self::Blink, Self::Look, Self::Roll];

    fn gap(self) -> Range<u64> {
        match self {
            Self::Blink => BLINK_GAP,
            Self::Look => LOOK_GAP,
            Self::Roll => ROLL_GAP,
        }
    }

    async fn play(self, app: &AppHandle, rng: &mut Rng) {
        match self {
            Self::Blink => blink(app, rng).await,
            Self::Look => look(app, rng).await,
            Self::Roll => roll(app, rng).await,
        }
    }
}

/// One animation's timer: wait a randomised gap, take the gate, play, release.
///
/// The gate is what keeps a blink, a glance and a roll from overlapping. A timer
/// that comes due while another animation is playing waits its turn rather than
/// being dropped, so the gap for one kind is its randomised interval plus
/// however long it had to queue.
fn spawn_timer(app: AppHandle, gate: Arc<tokio::sync::Mutex<()>>, animation: Animation, salt: u64) {
    let handle = tauri::async_runtime::spawn(async move {
        let mut rng = Rng::new(salt);

        while RUNNING.load(Ordering::Relaxed) {
            if !nap(rng.duration(animation.gap())).await {
                return;
            }

            let _turn = gate.lock().await;
            if !RUNNING.load(Ordering::Relaxed) {
                return;
            }

            animation.play(&app, &mut rng).await;
        }
    });

    if let Ok(mut tasks) = TASKS.lock() {
        tasks.push(handle);
    }
}

/// Begin animating. Safe to call from Tauri's `setup`, which runs on the main
/// thread. Does nothing at all if the frames cannot be decoded — the Dock keeps
/// the bundled icon.
pub fn start(app: &AppHandle) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let Some(images) = decode_frames() else {
        return;
    };

    IMAGES.with_borrow_mut(|cache| *cache = images);
    CURRENT.store(Frame::IdleCenter as u8, Ordering::Relaxed);
    apply(mtm, Frame::IdleCenter);

    RUNNING.store(true, Ordering::Relaxed);

    let gate = Arc::new(tokio::sync::Mutex::new(()));
    for (salt, animation) in Animation::ALL.into_iter().enumerate() {
        spawn_timer(app.clone(), gate.clone(), animation, salt as u64 + 1);
    }
}

/// Stop animating and hand the Dock back its bundled icon. Called on `Exit`, so
/// no timer task outlives the event loop.
pub fn shutdown() {
    RUNNING.store(false, Ordering::Relaxed);

    if let Ok(mut tasks) = TASKS.lock() {
        for task in tasks.drain(..) {
            task.abort();
        }
    }

    if let Some(mtm) = MainThreadMarker::new() {
        let app = NSApplication::sharedApplication(mtm);
        // SAFETY: called on the main thread, as witnessed by `mtm`. Passing nil
        // is the documented way to restore the icon from the bundle.
        unsafe { app.setApplicationIconImage(None) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A frame that fails to decode would silently drop the app back to the
    /// static icon at runtime, which is easy not to notice. Catch it at build
    /// time instead — this covers every embedded PNG.
    #[test]
    fn every_frame_decodes() {
        let frames = decode_frames().expect("all embedded dock frames should decode");
        assert_eq!(frames.len(), FRAME_BYTES.len());
    }

    /// Frames are indexed by discriminant, so a swapped or missing entry in
    /// FRAME_BYTES would show the wrong eyes rather than fail loudly.
    #[test]
    fn frame_indices_round_trip() {
        for (index, _) in FRAME_BYTES.iter().enumerate() {
            assert_eq!(Frame::from_index(index as u8) as usize, index);
        }
    }

    #[test]
    fn randomised_gaps_stay_in_range() {
        let mut rng = Rng::new(7);
        for _ in 0..1_000 {
            let blink = rng.duration(BLINK_GAP).as_millis() as u64;
            assert!(BLINK_GAP.contains(&blink), "{blink} outside {BLINK_GAP:?}");
            let roll = rng.duration(ROLL_STEP).as_millis() as u64;
            assert!(ROLL_STEP.contains(&roll), "{roll} outside {ROLL_STEP:?}");
            // Every pick must be a real direction, never an out-of-bounds index.
            assert!(LOOK_FRAMES.contains(&rng.pick(&LOOK_FRAMES)));
        }
    }
}
