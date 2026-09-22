"use client";

import { useEffect, useRef, useState } from "react";

const LIGHT_STEP_MS = 1000; // one light per second, as on the broadcast
const LIGHTS_OUT_AFTER_MS = 800; // pause on "lights out" before handing over

type Phase = "idle" | "counting" | "hold" | "out";

const TONE_HZ = 495; // measured from the broadcast
const TONE_PARTIALS = [[TONE_HZ, 1], [TONE_HZ * 2, 0.11], [TONE_HZ * 3, 0.07]] as const;
const HOLD_MIN_MS = 1200; // all five lit: long tone, then a random lights out
const HOLD_RANDOM_MS = 1300;

/**
 * Optional real recordings: drop these in public/sounds/ to replace the synth
 * (bring your own files; broadcast audio is not bundled). Missing files fall back silently.
 */
const SOUND_FILES = { light: "/sounds/start-light.mp3", out: "/sounds/lights-out.mp3" } as const;
type SoundName = keyof typeof SOUND_FILES;

/**
 * One start-light "beep", modelled on the broadcast sound (measured, not sampled):
 * a ~495 Hz tone (weak 2nd/3rd harmonics) for ~110 ms over a low triangle "thump"
 * that drops from 80 Hz to ~52 Hz and holds until it cuts off at ~335 ms, plus a
 * short knock on the attack.
 */
function lightBeep(ctx: AudioContext) {
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.35;
  out.connect(ctx.destination);

  const tone = ctx.createGain();
  tone.gain.setValueAtTime(0, t);
  tone.gain.linearRampToValueAtTime(0.32, t + 0.006);
  tone.gain.setValueAtTime(0.32, t + 0.1);
  tone.gain.linearRampToValueAtTime(0, t + 0.135);
  tone.connect(out);
  for (const [freq, level] of TONE_PARTIALS) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = freq;
    g.gain.value = level;
    osc.connect(g).connect(tone);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  const thump = ctx.createGain();
  thump.gain.setValueAtTime(0, t);
  thump.gain.linearRampToValueAtTime(0.6, t + 0.012);
  thump.gain.setValueAtTime(0.6, t + 0.31);
  thump.gain.linearRampToValueAtTime(0, t + 0.335);
  thump.connect(out);
  const low = ctx.createOscillator();
  low.type = "triangle";
  low.frequency.setValueAtTime(80, t);
  low.frequency.exponentialRampToValueAtTime(53, t + 0.1);
  low.frequency.linearRampToValueAtTime(52, t + 0.335);
  low.connect(thump);
  low.start(t);
  low.stop(t + 0.34);

  // Attack transient: a short ~150 Hz knock in the first ~40 ms
  const knock = ctx.createOscillator();
  const knockGain = ctx.createGain();
  knock.frequency.value = 150;
  knockGain.gain.setValueAtTime(0, t);
  knockGain.gain.linearRampToValueAtTime(0.4, t + 0.004);
  knockGain.gain.setValueAtTime(0.4, t + 0.03);
  knockGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  knock.connect(knockGain).connect(out);
  knock.start(t);
  knock.stop(t + 0.065);
}

/**
 * Lights out: a field of high-revving cars (detuned sawtooths with throttle wobble
 * plus filtered noise) sweeping up through a gear change as they pull away and fade.
 */
function launchRoar(ctx: AudioContext, out: AudioNode) {
  const n = ctx.currentTime;
  const sources: AudioScheduledSourceNode[] = [];
  const engines = ctx.createGain();
  engines.gain.setValueAtTime(0, n);
  engines.gain.linearRampToValueAtTime(0.28, n + 0.25);
  engines.gain.exponentialRampToValueAtTime(0.001, n + 3);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1500, n);
  filter.frequency.linearRampToValueAtTime(3200, n + 0.4);
  filter.connect(engines).connect(out);

  for (let i = 0; i < 6; i++) {
    const base = 280 + i * 21 + Math.random() * 12; // ~V6 firing frequency at high revs
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(base, n);
    osc.frequency.exponentialRampToValueAtTime(base * 1.7, n + 0.8);
    osc.frequency.linearRampToValueAtTime(base * 1.25, n + 0.9);
    osc.frequency.exponentialRampToValueAtTime(base * 1.85, n + 1.9);
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 2 + Math.random() * 3;
    depth.gain.value = 12 + Math.random() * 18;
    lfo.connect(depth).connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.18;
    osc.connect(g).connect(filter);
    sources.push(osc, lfo);
  }

  const noise = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buf;
  noise.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 900;
  band.Q.value = 0.8;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.25;
  noise.connect(band).connect(noiseGain).connect(filter);
  sources.push(noise);

  for (const src of sources) {
    src.start(n);
    src.stop(n + 3.05);
  }
}

/** Handle for the sound that runs while all five lights are on. */
interface GridSound {
  /** Lights out: cut the tone, engines launch and pull away. */
  launch(withRoar: boolean): void;
  /** Tour closed mid-hold: silence everything now. */
  stop(): void;
}

/**
 * All five lights on: the beep's tone held as a long "tuuu". launch() cuts it and
 * hands over to launchRoar(), the grid pulling away at full throttle.
 */
function gridSound(ctx: AudioContext): GridSound {
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.35;
  out.connect(ctx.destination);
  const oscs: OscillatorNode[] = [];

  const tone = ctx.createGain();
  tone.gain.setValueAtTime(0, t);
  tone.gain.linearRampToValueAtTime(0.32, t + 0.006);
  tone.connect(out);
  for (const [freq, level] of TONE_PARTIALS) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = freq;
    g.gain.value = level;
    osc.connect(g).connect(tone);
    osc.start(t);
    oscs.push(osc);
  }

  const cut = (fadeS: number) => {
    const n = ctx.currentTime;
    tone.gain.cancelScheduledValues(n);
    tone.gain.setValueAtTime(tone.gain.value, n);
    tone.gain.linearRampToValueAtTime(0, n + fadeS);
    for (const osc of oscs) osc.stop(n + fadeS + 0.01);
  };

  return {
    launch(withRoar) {
      cut(0.04);
      if (withRoar) launchRoar(ctx, out);
    },
    stop() {
      cut(0.05);
    },
  };
}

/**
 * F1 start gantry you trigger yourself: five columns light up one by one, hold
 * for a random beat like a real start (1.2–2.5s here, the FIA uses up to 3s),
 * then all go out and `onLightsOut` fires.
 */
export default function StartLights({ onLightsOut }: { onLightsOut: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [lit, setLit] = useState(0);
  // Ref so a parent re-render (new callback) can't restart the timers mid-sequence
  const onLightsOutRef = useRef(onLightsOut);
  onLightsOutRef.current = onLightsOut;
  const audioRef = useRef<AudioContext | null>(null);
  const rawRef = useRef<Partial<Record<SoundName, ArrayBuffer>>>({});
  const buffersRef = useRef<Partial<Record<SoundName, AudioBuffer>>>({});
  const gridRef = useRef<GridSound | null>(null);

  // Prefetch optional recordings; decoded once an AudioContext exists (on click).
  useEffect(() => {
    for (const [name, url] of Object.entries(SOUND_FILES) as [SoundName, string][]) {
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((buf) => {
          if (buf) rawRef.current[name] = buf;
        })
        .catch(() => {});
    }
  }, []);

  /** Plays the recording when provided, else the synth fallback. */
  const play = (name: SoundName, fallback: (ctx: AudioContext) => void) => {
    const ctx = audioRef.current;
    if (!ctx) return;
    try {
      const buffer = buffersRef.current[name];
      if (buffer) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(ctx.destination);
        src.start();
      } else fallback(ctx);
    } catch {
      /* audio is decoration only */
    }
  };

  // One beep per light; long tone while all five are lit; engines at full throttle on lights out.
  useEffect(() => {
    const ctx = audioRef.current;
    if (phase === "counting" && lit >= 1) play("light", lightBeep);
    else if (phase === "hold" && ctx) {
      try {
        gridRef.current = gridSound(ctx);
      } catch {
        /* audio is decoration only */
      }
    } else if (phase === "out") {
      const recording = !!buffersRef.current.out;
      gridRef.current?.launch(!recording); // a provided lights-out recording replaces the synth roar
      gridRef.current = null;
      if (recording) play("out", () => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- play only reads refs
  }, [phase, lit]);

  // Unmount: cut a grid sound still holding (tour skipped / Back), but let the launch
  // roar (~3s, card unmounts ~0.8s after lights out) finish before releasing the context.
  useEffect(() => () => {
    gridRef.current?.stop();
    const ctx = audioRef.current;
    if (ctx) window.setTimeout(() => void ctx.close(), 3500);
  }, []);

  useEffect(() => {
    let t: number | undefined;
    if (phase === "counting") {
      t = window.setTimeout(() => {
        if (lit < 5) setLit(lit + 1);
        else setPhase("hold");
      }, LIGHT_STEP_MS);
    } else if (phase === "hold") {
      t = window.setTimeout(() => setPhase("out"), HOLD_MIN_MS + Math.random() * HOLD_RANDOM_MS);
    } else if (phase === "out") {
      t = window.setTimeout(() => onLightsOutRef.current(), LIGHTS_OUT_AFTER_MS);
    }
    return () => window.clearTimeout(t);
  }, [phase, lit]);

  const start = async () => {
    // Created on the click so browsers allow playback (autoplay policy)
    try {
      const ctx = (audioRef.current ??= new AudioContext());
      // Decode recordings before the first light, so every beep uses the same sound
      await Promise.all(
        (Object.entries(rawRef.current) as [SoundName, ArrayBuffer][]).map(([name, raw]) => {
          delete rawRef.current[name]; // decodeAudioData detaches the buffer: decode once
          return ctx.decodeAudioData(raw).then((b) => void (buffersRef.current[name] = b), () => {});
        }),
      );
    } catch {
      /* no Web Audio: run silently */
    }
    setLit(1);
    setPhase("counting");
  };

  const out = phase === "out";
  const caption =
    phase === "idle"
      ? "Five red lights. When they go out, you're racing."
      : out
        ? "Lights out and away we go!"
        : lit >= 5
          ? "Hold it…"
          : "Eyes on the lights…";

  return (
    <div className="mb-1 mt-2 flex flex-col items-center gap-3">
      <div
        className={`flex gap-1.5 rounded-lg border border-white/10 bg-black/60 p-1.5 shadow-inner ${
          out ? "animate-[lights-out-jolt_0.35s_ease-out]" : ""
        }`}
        aria-hidden
      >
        {[1, 2, 3, 4, 5].map((i) => {
          const on = !out && phase !== "idle" && lit >= i;
          return (
            <div key={i} className="flex flex-col gap-1 rounded-md bg-[#0a0a0f] px-1.5 py-1.5 ring-1 ring-inset ring-white/[0.06]">
              {[0, 1].map((row) => (
                <span
                  key={`${row}-${on}`}
                  className={`h-4 w-4 rounded-full ${
                    on
                      ? "animate-[light-on_0.25s_ease-out] bg-[#ff1a0d] shadow-[0_0_10px_2px_rgba(255,26,13,0.75),inset_0_-2px_3px_rgba(0,0,0,0.35)]"
                      : "bg-[#1c1c24] shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)] transition-colors duration-75"
                  }`}
                />
              ))}
            </div>
          );
        })}
      </div>

      <p
        key={caption}
        className={`animate-[tour-in_0.3s_ease-out] text-center ${
          out
            ? "text-[11px] font-extrabold uppercase tracking-[0.2em] text-white"
            : "text-xs font-medium text-f1-muted"
        }`}
        role="status"
      >
        {caption}
      </p>

      {phase === "idle" && (
        <button
          onClick={start}
          className="rounded-full bg-f1-red px-5 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-[0_0_18px_rgba(225,6,0,0.45)] transition-shadow hover:shadow-[0_0_26px_rgba(225,6,0,0.7)]"
        >
          Start the race
        </button>
      )}
    </div>
  );
}
