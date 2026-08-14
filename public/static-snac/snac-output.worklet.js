const INPUT_RATE = 24_000;
const CAPACITY_FRAMES = INPUT_RATE * 15;
const STRETCH_FRAME = 960;
const STRETCH_HOP = 480;
const SEARCH_RADIUS = 120;

class SnacRingOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(CAPACITY_FRAMES);
    this.writeAbs = 0;
    this.directReadAbs = 0;
    this.analysisAbs = 0;
    this.stretchOutput = new Float32Array(STRETCH_HOP);
    this.stretchOffset = STRETCH_HOP;
    this.previousTail = new Float32Array(STRETCH_HOP);
    this.nextTail = new Float32Array(STRETCH_HOP);
    this.hasPreviousTail = false;
    this.fadeIn = new Float32Array(STRETCH_HOP);
    this.fadeOut = new Float32Array(STRETCH_HOP);
    for (let index = 0; index < STRETCH_HOP; index += 1) {
      const phase = (index + 0.5) / STRETCH_HOP * Math.PI / 2;
      this.fadeIn[index] = Math.sin(phase);
      this.fadeOut[index] = Math.cos(phase);
    }
    this.bufferedFrames = 0;
    this.consumedFrames = 0;
    this.generation = 0;
    this.playing = false;
    this.rate = 1;
    this.underruns = 0;
    this.wasUnderrun = false;
    this.reportCounter = 0;
    this.renderedRms = 0;
    this.renderedPeak = 0;
    this.renderedFrames = 0;
    this.port.addEventListener("message", (event) => this.handleMessage(event.data));
    this.port.start();
  }

  sampleAt(absoluteIndex) {
    return this.ring[((absoluteIndex % CAPACITY_FRAMES) + CAPACITY_FRAMES) % CAPACITY_FRAMES];
  }

  sourceCursor() {
    return Math.abs(this.rate - 1) < 0.001
      ? this.directReadAbs
      : Math.floor(this.analysisAbs);
  }

  resetStretchState(sourceCursor = this.sourceCursor()) {
    this.directReadAbs = sourceCursor;
    this.analysisAbs = sourceCursor;
    this.stretchOffset = STRETCH_HOP;
    this.hasPreviousTail = false;
  }

  handleMessage(message) {
    if (message.kind === "reset") {
      this.writeAbs = 0;
      this.directReadAbs = 0;
      this.analysisAbs = 0;
      this.stretchOffset = STRETCH_HOP;
      this.hasPreviousTail = false;
      this.bufferedFrames = 0;
      this.consumedFrames = 0;
      this.generation = message.generation;
      this.playing = false;
      this.underruns = 0;
      this.wasUnderrun = false;
      this.renderedRms = 0;
      this.renderedPeak = 0;
      this.renderedFrames = 0;
      this.report();
      return;
    }
    if (message.generation !== this.generation) return;
    if (message.kind === "play") {
      this.playing = true;
      this.report();
      return;
    }
    if (message.kind === "pause") {
      this.playing = false;
      this.report();
      return;
    }
    if (message.kind === "rate") {
      const nextRate = Math.min(2, Math.max(0.75, Number(message.rate) || 1));
      if (Math.abs(nextRate - this.rate) > 0.001) {
        const sourceCursor = this.sourceCursor();
        this.rate = nextRate;
        this.resetStretchState(sourceCursor);
      }
      return;
    }
    if (message.kind !== "push") return;

    const pcm = new Float32Array(message.pcm);
    if (pcm.length > CAPACITY_FRAMES - this.bufferedFrames) {
      this.port.postMessage({
        kind: "error",
        generation: this.generation,
        message: "Audio ring buffer capacity exceeded.",
      });
      return;
    }
    for (let index = 0; index < pcm.length; index += 1) {
      this.ring[this.writeAbs % CAPACITY_FRAMES] = pcm[index];
      this.writeAbs += 1;
    }
    this.updateBuffered();
    this.report();
  }

  updateBuffered() {
    const sourceCursor = Math.abs(this.rate - 1) < 0.001
      ? this.directReadAbs
      : Math.floor(this.analysisAbs);
    this.bufferedFrames = Math.max(0, this.writeAbs - sourceCursor);
  }

  bestCandidate(expected) {
    if (!this.hasPreviousTail) return Math.floor(expected);
    let bestStart = Math.floor(expected);
    let bestScore = -Infinity;
    for (let delta = -SEARCH_RADIUS; delta <= SEARCH_RADIUS; delta += 4) {
      const start = Math.max(0, Math.floor(expected + delta));
      if (start + STRETCH_FRAME > this.writeAbs) continue;
      let score = 0;
      for (let index = 0; index < STRETCH_HOP; index += 8) {
        score += this.previousTail[index] * this.sampleAt(start + index);
      }
      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
      }
    }
    return bestStart;
  }

  generateStretchHop() {
    if (!this.hasPreviousTail) {
      if (this.analysisAbs + STRETCH_FRAME > this.writeAbs) return false;
      for (let index = 0; index < STRETCH_HOP; index += 1) {
        this.stretchOutput[index] = this.sampleAt(this.analysisAbs + index);
        this.previousTail[index] =
          this.sampleAt(this.analysisAbs + STRETCH_HOP + index);
      }
      this.stretchOffset = 0;
      this.hasPreviousTail = true;
      this.analysisAbs += this.rate * STRETCH_HOP;
      this.updateBuffered();
      return true;
    }

    const expected = this.analysisAbs;
    if (expected + SEARCH_RADIUS + STRETCH_FRAME > this.writeAbs) return false;
    const candidate = this.bestCandidate(expected);
    for (let index = 0; index < STRETCH_HOP; index += 1) {
      this.stretchOutput[index] =
        this.previousTail[index] * this.fadeOut[index]
        + this.sampleAt(candidate + index) * this.fadeIn[index];
      this.nextTail[index] =
        this.sampleAt(candidate + STRETCH_HOP + index);
    }
    const oldTail = this.previousTail;
    this.previousTail = this.nextTail;
    this.nextTail = oldTail;
    this.stretchOffset = 0;
    this.analysisAbs = candidate + this.rate * STRETCH_HOP;
    this.updateBuffered();
    return true;
  }

  nextStretchedSample() {
    if (this.stretchOffset >= STRETCH_HOP) {
      if (!this.generateStretchHop()) return null;
    }
    const value = this.stretchOutput[this.stretchOffset];
    this.stretchOffset += 1;
    this.consumedFrames = Math.floor(this.analysisAbs);
    return value;
  }

  report() {
    this.port.postMessage({
      kind: "stats",
      generation: this.generation,
      bufferedFrames: this.bufferedFrames,
      consumedFrames: this.consumedFrames,
      underruns: this.underruns,
      playing: this.playing,
      renderedRms: this.renderedRms,
      renderedPeak: this.renderedPeak,
      renderedFrames: this.renderedFrames,
    });
  }

  process(_inputs, outputs) {
    const output = outputs[0][0];
    output.fill(0);
    if (!this.playing) return true;

    let written = 0;
    if (Math.abs(this.rate - 1) < 0.001) {
      while (written < output.length && this.directReadAbs < this.writeAbs) {
        output[written] = this.sampleAt(this.directReadAbs);
        this.directReadAbs += 1;
        this.consumedFrames += 1;
        written += 1;
      }
      this.updateBuffered();
    } else {
      while (written < output.length) {
        const value = this.nextStretchedSample();
        if (value === null) break;
        output[written] = value;
        written += 1;
      }
    }

    const underrun = written < output.length;
    let squareSum = 0;
    let peak = 0;
    for (let index = 0; index < written; index += 1) {
      const value = output[index];
      squareSum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    this.renderedRms = written > 0 ? Math.sqrt(squareSum / written) : 0;
    this.renderedPeak = peak;
    this.renderedFrames += written;
    if (underrun && !this.wasUnderrun) this.underruns += 1;
    this.wasUnderrun = underrun;
    this.reportCounter += 1;
    if (this.reportCounter >= 48 || underrun) {
      this.reportCounter = 0;
      this.report();
    }
    return true;
  }
}

registerProcessor("snac-ring-output", SnacRingOutput);
