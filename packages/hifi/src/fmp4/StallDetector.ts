const STALL_THRESHOLD_SECONDS = 1;
const STALL_SKIP_SECONDS = 0.1;
const MAX_CONSECUTIVE_NUDGES = 2;
const RANGE_START_TOLERANCE_SECONDS = 0.1;
const RANGE_END_EXCLUSION_SECONDS = 0.5;
const MILLISECONDS_PER_SECOND = 1000;

export class StallDetector {
  private lastValue: number | null = null;
  private lastShouldBeMakingProgress = false;
  private lastUpdateMs = 0;
  private didNudge = false;
  private lastNudgedTo: number | null = null;
  private consecutiveNudges = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  poll(audio: HTMLAudioElement, buffered: TimeRanges): boolean {
    const value = audio.currentTime;
    const shouldBeMakingProgress = this.shouldBeMakingProgress(audio, buffered);

    const observedChange =
      value !== this.lastValue ||
      shouldBeMakingProgress !== this.lastShouldBeMakingProgress;

    if (observedChange) {
      if (value !== this.lastValue && value !== this.lastNudgedTo) {
        this.consecutiveNudges = 0;
        this.lastNudgedTo = null;
      }
      this.lastValue = value;
      this.lastShouldBeMakingProgress = shouldBeMakingProgress;
      this.lastUpdateMs = this.now();
      this.didNudge = false;
      return false;
    }

    if (
      !shouldBeMakingProgress ||
      this.didNudge ||
      this.consecutiveNudges >= MAX_CONSECUTIVE_NUDGES
    ) {
      return false;
    }

    const stalledSeconds =
      (this.now() - this.lastUpdateMs) / MILLISECONDS_PER_SECOND;
    if (stalledSeconds < STALL_THRESHOLD_SECONDS) {
      return false;
    }

    const nextTime = value + STALL_SKIP_SECONDS;
    this.didNudge = true;
    this.lastNudgedTo = nextTime;
    this.consecutiveNudges += 1;
    audio.currentTime = nextTime;
    return true;
  }

  private shouldBeMakingProgress(
    audio: HTMLAudioElement,
    buffered: TimeRanges,
  ): boolean {
    if (audio.paused || audio.playbackRate === 0 || buffered.length === 0) {
      return false;
    }

    return this.hasContentFor(buffered, audio.currentTime);
  }

  private hasContentFor(buffered: TimeRanges, time: number): boolean {
    for (let rangeIndex = 0; rangeIndex < buffered.length; rangeIndex++) {
      if (time < buffered.start(rangeIndex) - RANGE_START_TOLERANCE_SECONDS) {
        continue;
      }
      if (time > buffered.end(rangeIndex) - RANGE_END_EXCLUSION_SECONDS) {
        continue;
      }
      return true;
    }
    return false;
  }
}
