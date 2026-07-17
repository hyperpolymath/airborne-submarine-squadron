// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>
//
// sfx.js — Web Audio API synthesised sound engine for Airborne Submarine Squadron.
//
// Design principles:
//   - All sounds generated procedurally via AudioContext oscillators and noise buffers.
//     No audio files are loaded or fetched.
//   - AudioContext is created lazily on the first user gesture to comply with the
//     browser autoplay policy (Chrome/Firefox both enforce this).
//   - Graceful degradation: if AudioContext is unavailable (e.g. sandboxed iframe,
//     older browser) every method silently becomes a no-op.
//   - Master gain node + per-sound gain = full volume and mute control.
//
// Public API (all methods safe to call before any user gesture):
//   SFX.setVolume(0..1)   — set master volume
//   SFX.mute()            — silence all audio
//   SFX.unmute()          — restore audio
//   SFX.isMuted()         — returns boolean
//
//   Gameplay sounds:
//     SFX.torpedoLaunch()
//     SFX.torpedoSplash()
//     SFX.torpedoHit()
//     SFX.missileLaunch()
//     SFX.missileIgnite()
//     SFX.explodeSmall()
//     SFX.explodeBig()
//     SFX.damage()
//     SFX.islandCrash()
//     SFX.enemyDestroyed()
//     SFX.gameOver()
//     SFX.thrustPulse()
//     SFX.waterSplash()
//     SFX.waterBob()
//     SFX.disembark()
//     SFX.embark()
//     SFX.pickup()
//     SFX.depthChargeSplash()
//     SFX.dive()
//     SFX.surface()
//     SFX.thrustAir()
//     SFX.thrustWater()

'use strict';

const SFX = (function () {
  // ------------------------------------------------------------------ //
  // Internal state
  // ------------------------------------------------------------------ //

  /** @type {AudioContext|null} Created lazily on first user gesture. */
  let _ctx = null;

  /** @type {GainNode|null} Master gain node, wired to destination. */
  let _masterGain = null;

  /** Master volume level (0..1). Persisted across mute/unmute cycles. */
  let _volume = 0.5;

  /** Whether audio is currently muted. */
  let _muted = false;

  // ------------------------------------------------------------------ //
  // Context initialisation (lazy, autoplay-policy-safe)
  // ------------------------------------------------------------------ //

  /**
   * Returns the AudioContext (and master gain), creating both on the first
   * call. If the context is in a suspended state (common after page load
   * before a user gesture) it is resumed.
   *
   * Returns null if AudioContext is not available in this browser.
   *
   * @returns {AudioContext|null}
   */
  function _getCtx() {
    if (_ctx) {
      // Resume if suspended (tab was backgrounded, or first post-gesture call).
      if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
      return _ctx;
    }

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;           // Graceful degradation.

    try {
      _ctx = new Ctor();
    } catch (_err) {
      return null;                    // Sandboxed iframe or permission denied.
    }

    // Build the master gain node wired to the hardware output.
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = _muted ? 0 : _volume;
    _masterGain.connect(_ctx.destination);

    if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});

    return _ctx;
  }

  // ------------------------------------------------------------------ //
  // Low-level synthesis helpers
  // ------------------------------------------------------------------ //

  /**
   * Play a single oscillator tone with a linear or exponential volume envelope.
   *
   * @param {number}  freq    - Fundamental frequency in Hz.
   * @param {number}  dur     - Duration in seconds.
   * @param {string}  type    - OscillatorType ('sine'|'square'|'sawtooth'|'triangle').
   * @param {number}  vol     - Peak gain (pre-master, 0..1).
   * @param {number}  [det=0] - Detune in cents.
   * @param {number}  [delay=0] - Start delay in seconds (relative to now).
   * @param {number}  [attack=0]  - Linear ramp-up from 0 to vol (seconds).
   * @param {number}  [freqEnd]   - If provided, sweep frequency from freq to freqEnd.
   */
  function _tone(freq, dur, type, vol, det, delay, attack, freqEnd) {
    const ac = _getCtx();
    if (!ac) return;

    const now = ac.currentTime + (delay || 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), now + dur);
    }
    if (det) osc.detune.value = det;

    if (attack && attack > 0) {
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(vol || 0.15, now + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    } else {
      gain.gain.setValueAtTime(vol || 0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    }

    osc.connect(gain);
    gain.connect(_masterGain || (function () {
      // _masterGain may be null if AudioContext creation failed partway — bail.
      osc.disconnect(); return { connect() {} };
    })());
    osc.start(now);
    osc.stop(now + dur + 0.01);
  }

  /**
   * Play a band-limited white-noise burst with an exponential decay envelope.
   *
   * @param {number} dur      - Duration in seconds.
   * @param {number} vol      - Peak gain (pre-master, 0..1).
   * @param {string} [filterType='lowpass'] - BiquadFilter type.
   * @param {number} [filterFreq=600]       - Filter cutoff in Hz.
   * @param {number} [delay=0]              - Start delay in seconds.
   * @param {number} [filterQ=1]            - Filter Q factor.
   */
  function _noise(dur, vol, filterType, filterFreq, delay, filterQ) {
    const ac = _getCtx();
    if (!ac) return;
    if (!_masterGain) return;

    const now = ac.currentTime + (delay || 0);
    const sampleCount = Math.ceil(ac.sampleRate * dur);
    const buffer = ac.createBuffer(1, sampleCount, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = ac.createBufferSource();
    src.buffer = buffer;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(vol || 0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    const filt = ac.createBiquadFilter();
    filt.type = filterType || 'lowpass';
    filt.frequency.value = filterFreq || 600;
    if (filterQ) filt.Q.value = filterQ;

    src.connect(filt);
    filt.connect(gain);
    gain.connect(_masterGain);

    src.start(now);
    src.stop(now + dur + 0.01);
  }

  /**
   * Simple frequency modulation: a carrier oscillator whose frequency is
   * offset by a modulator oscillator. Useful for engine hum and wobbly tones.
   *
   * @param {number} carrierFreq - Carrier centre frequency in Hz.
   * @param {number} modFreq     - Modulator frequency in Hz.
   * @param {number} modDepth    - Modulator depth in cents.
   * @param {number} dur         - Duration in seconds.
   * @param {number} vol         - Peak gain (pre-master).
   * @param {string} [type='sine'] - Carrier oscillator type.
   * @param {number} [delay=0]
   */
  function _fm(carrierFreq, modFreq, modDepth, dur, vol, type, delay) {
    const ac = _getCtx();
    if (!ac || !_masterGain) return;

    const now = ac.currentTime + (delay || 0);

    const modOsc = ac.createOscillator();
    modOsc.frequency.value = modFreq;
    const modGain = ac.createGain();
    modGain.gain.value = modDepth;
    modOsc.connect(modGain);

    const carrier = ac.createOscillator();
    carrier.type = type || 'sine';
    carrier.frequency.value = carrierFreq;
    modGain.connect(carrier.detune);

    const outGain = ac.createGain();
    outGain.gain.setValueAtTime(vol || 0.1, now);
    outGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    carrier.connect(outGain);
    outGain.connect(_masterGain);

    modOsc.start(now);
    carrier.start(now);
    modOsc.stop(now + dur + 0.01);
    carrier.stop(now + dur + 0.01);
  }

  // ------------------------------------------------------------------ //
  // Volume / mute API
  // ------------------------------------------------------------------ //

  /**
   * Set the master volume.
   * @param {number} v - A value in the range [0, 1].
   */
  function setVolume(v) {
    _volume = Math.max(0, Math.min(1, v));
    if (_masterGain && !_muted) {
      _masterGain.gain.setTargetAtTime(_volume, _getCtx().currentTime, 0.015);
    }
  }

  /** Silence all audio without discarding the current volume level. */
  function mute() {
    _muted = true;
    if (_masterGain) {
      _masterGain.gain.setTargetAtTime(0, _getCtx().currentTime, 0.015);
    }
  }

  /** Restore audio to the last set volume level. */
  function unmute() {
    _muted = false;
    if (_masterGain) {
      _masterGain.gain.setTargetAtTime(_volume, _getCtx().currentTime, 0.015);
    }
  }

  /** @returns {boolean} True when audio is muted. */
  function isMuted() {
    return _muted;
  }

  // ------------------------------------------------------------------ //
  // Sound definitions
  // ------------------------------------------------------------------ //

  /**
   * torpedoLaunch — low underwater bubble-whoosh as the tube opens.
   * Sine sweep downward (like a cavitation burst) plus brief noise.
   */
  function torpedoLaunch() {
    _tone(260, 0.12, 'sine', 0.13, 0, 0, 0.01, 80);   // Frequency sweep 260→80 Hz
    _noise(0.18, 0.09, 'lowpass', 300, 0);
  }

  /**
   * torpedoSplash — entry into water: sharp attack noise + low thud.
   */
  function torpedoSplash() {
    _noise(0.14, 0.12, 'bandpass', 800, 0, 2);
    _tone(70, 0.12, 'sine', 0.08, 0);
  }

  /**
   * torpedoHit — underwater explosion; deep bass thump with rolling noise.
   */
  function torpedoHit() {
    _tone(55, 0.35, 'sine', 0.25, 0, 0, 0.02);
    _noise(0.4, 0.2, 'lowpass', 400, 0);
    _noise(0.15, 0.12, 'bandpass', 2000, 0.02, 3);
  }

  /**
   * missileLaunch — ignition roar: sawtooth sweep upward + burst of noise.
   */
  function missileLaunch() {
    _tone(120, 0.08, 'sawtooth', 0.12, 0, 0, 0.01, 600);   // 120→600 Hz ignition chirp
    _tone(500, 0.30, 'sawtooth', 0.14, 0, 0.05);            // Sustain roar
    _noise(0.20, 0.10, 'highpass', 1200, 0);                 // Hiss / exhaust
  }

  /**
   * missileIgnite — secondary booster kick; sharper and higher than launch.
   */
  function missileIgnite() {
    _tone(280, 0.05, 'sawtooth', 0.10, 0, 0, 0, 900);
    _tone(900, 0.20, 'sawtooth', 0.11, 0, 0.04);
    _noise(0.10, 0.08, 'highpass', 2000, 0);
  }

  /**
   * explodeSmall — short pop with a bit of crackle; like a grenade.
   */
  function explodeSmall() {
    _noise(0.22, 0.18, 'lowpass', 800, 0);
    _tone(130, 0.15, 'sine', 0.12, 0);
    _noise(0.08, 0.10, 'highpass', 3000, 0.01);
  }

  /**
   * explodeBig — full explosion: deep bass rumble + mid crunch + high snap.
   */
  function explodeBig() {
    _noise(0.50, 0.30, 'lowpass', 500, 0);
    _tone(50, 0.40, 'sine', 0.22, 0, 0, 0.02);
    _tone(35, 0.50, 'triangle', 0.14, 0, 0.02);
    _noise(0.20, 0.15, 'bandpass', 3000, 0.03, 1);
  }

  /**
   * damage — hull impact: sharp noise thud + low square blip.
   */
  function damage() {
    _noise(0.12, 0.15, 'lowpass', 700, 0);
    _tone(85, 0.10, 'square', 0.10, 0);
  }

  /**
   * islandCrash — crunching into rock: heavy sustained noise + deep bass.
   */
  function islandCrash() {
    _noise(0.38, 0.35, 'lowpass', 400, 0);
    _tone(45, 0.30, 'sine', 0.22, 0, 0, 0.01);
    _tone(30, 0.42, 'triangle', 0.16, 0, 0.02);
    _noise(0.15, 0.12, 'highpass', 1500, 0.04);
  }

  /**
   * enemyDestroyed — satisfying crunch-boom + ascending victory blip.
   */
  function enemyDestroyed() {
    _noise(0.40, 0.22, 'lowpass', 600, 0);
    _tone(180, 0.12, 'square', 0.10, 0);
    _tone(240, 0.10, 'square', 0.08, 0, 0.08);
    _tone(320, 0.10, 'square', 0.09, 0, 0.16);
    _tone(90, 0.28, 'sine', 0.14, 0, 0.02);
  }

  /**
   * gameOver — dramatic descending fanfare; three falling square tones + rumble.
   */
  function gameOver() {
    _tone(330, 0.22, 'square', 0.12, 0, 0);
    _tone(220, 0.28, 'square', 0.12, 0, 0.18);
    _tone(110, 0.50, 'sawtooth', 0.16, 0, 0.38);
    _noise(0.70, 0.22, 'lowpass', 500, 0.30);
  }

  /**
   * thrustPulse — low-frequency engine throb; called on a timer while thrusting.
   * Very quiet sawtooth pulse with random detune for texture.
   */
  function thrustPulse() {
    _tone(62, 0.10, 'sawtooth', 0.04, (Math.random() * 40) - 20);
  }

  /**
   * thrustAir — persistent air-mode engine note (call once per thrust burst).
   * Higher frequency droning sawtooth + FM modulation.
   */
  function thrustAir() {
    _tone(180, 0.15, 'sawtooth', 0.05, 0, 0, 0.02);
    _fm(180, 8, 300, 0.15, 0.04, 'sawtooth', 0);
  }

  /**
   * thrustWater — underwater propulsion: lower, wetter, bubbly.
   */
  function thrustWater() {
    _tone(90, 0.14, 'sawtooth', 0.05, 0);
    _noise(0.10, 0.04, 'bandpass', 400, 0, 1.5);
  }

  /**
   * waterSplash — breaking the surface: sharp high-frequency noise burst.
   */
  function waterSplash() {
    _noise(0.18, 0.14, 'bandpass', 1200, 0, 2);
    _tone(140, 0.12, 'sine', 0.07, 0);
  }

  /**
   * waterBob — gentle hull rocking on the water: soft low sine pulse.
   */
  function waterBob() {
    _tone(95, 0.07, 'sine', 0.04, 0, 0, 0.01);
  }

  /**
   * depthChargeSplash — splash + low rolling rumble as the charge sinks.
   */
  function depthChargeSplash() {
    _noise(0.20, 0.18, 'bandpass', 900, 0, 2.5);
    _tone(60, 0.45, 'sine', 0.18, 0, 0.05, 0.03);
    _noise(0.35, 0.12, 'lowpass', 350, 0.10);
  }

  /**
   * dive — transition from surface to underwater: descending whoosh.
   * Frequency sweeps steeply downward; noise rolls off with a lowpass filter.
   */
  function dive() {
    _tone(600, 0.35, 'sine', 0.12, 0, 0, 0.02, 80);    // 600→80 Hz dive whistle
    _noise(0.30, 0.12, 'lowpass', 1000, 0);
    _noise(0.20, 0.08, 'lowpass', 300, 0.15);
  }

  /**
   * surface — transition from underwater to air: ascending gurgling whoosh.
   */
  function surface() {
    _tone(80, 0.32, 'sine', 0.12, 0, 0, 0.03, 550);    // 80→550 Hz surface whoosh
    _noise(0.25, 0.14, 'bandpass', 1200, 0, 1.5);
    _noise(0.12, 0.08, 'highpass', 2500, 0.18);
  }

  /**
   * disembark — three rising tones: confirmation / boarding ping.
   */
  function disembark() {
    _tone(440, 0.10, 'sine', 0.09, 0, 0);
    _tone(550, 0.10, 'sine', 0.07, 0, 0.08);
    _tone(660, 0.16, 'sine', 0.09, 0, 0.16);
  }

  /**
   * embark — three falling tones: departure ping (reverse of disembark).
   */
  function embark() {
    _tone(660, 0.10, 'sine', 0.09, 0, 0);
    _tone(550, 0.10, 'sine', 0.07, 0, 0.08);
    _tone(440, 0.16, 'sine', 0.09, 0, 0.16);
  }

  /**
   * pickup — collecting an item: bright upward chirp, distinctive from damage.
   */
  function pickup() {
    _tone(440, 0.07, 'square', 0.08, 0, 0);
    _tone(660, 0.07, 'square', 0.09, 0, 0.05);
    _tone(880, 0.12, 'sine', 0.10, 0, 0.10);
  }

  // ------------------------------------------------------------------ //
  // MUSIC SYSTEM — Generative synthesised background tracks
  //
  // Tracks: 'ambient', 'lightning', 'berkut', 'akula', 'nemesis', 'none'
  // Each track is a set of looping oscillators routed through a
  // track-specific gain node. Switching tracks crossfades over ~1.5s.
  // ------------------------------------------------------------------ //

  let _currentTrack = 'none';
  let _trackNodes = [];       // { osc, gain, lfo } for current track
  let _trackGain = null;      // Master gain for all music
  const _MUSIC_VOLUME = 0.12; // Music is quiet relative to SFX
  const _FADE_TIME = 1.5;     // Crossfade duration in seconds

  function _ensureMusicGain() {
    const ac = _getCtx();
    if (!ac || _trackGain) return;
    _trackGain = ac.createGain();
    _trackGain.gain.value = _muted ? 0 : _MUSIC_VOLUME;
    _trackGain.connect(_masterGain);
  }

  function _stopTrack() {
    const ac = _getCtx();
    if (!ac) return;
    const now = ac.currentTime;
    for (const node of _trackNodes) {
      try {
        if (node.gain) {
          node.gain.gain.cancelScheduledValues(now);
          node.gain.gain.setValueAtTime(node.gain.gain.value, now);
          node.gain.gain.linearRampToValueAtTime(0, now + _FADE_TIME);
        }
        if (node.osc) node.osc.stop(now + _FADE_TIME + 0.1);
        if (node.lfo) node.lfo.stop(now + _FADE_TIME + 0.1);
      } catch (_) { /* already stopped */ }
    }
    _trackNodes = [];
  }

  function _pad(freq, type, vol, lfoRate, lfoDepth) {
    const ac = _getCtx();
    if (!ac) return null;
    _ensureMusicGain();
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type || 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol || 0.04, now + _FADE_TIME);
    osc.connect(gain);
    gain.connect(_trackGain);
    // LFO for breathing volume
    let lfo = null;
    if (lfoRate) {
      lfo = ac.createOscillator();
      const lfoGain = ac.createGain();
      lfo.frequency.value = lfoRate;
      lfoGain.gain.value = lfoDepth || 0.01;
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      lfo.start(now);
    }
    osc.start(now);
    return { osc, gain, lfo };
  }

  function _buildAmbient() {
    // Calm pad: C3-Eb3-G3 minor chord, triangle waves, gentle LFO breathing
    const nodes = [];
    nodes.push(_pad(130.81, 'triangle', 0.035, 0.15, 0.012));  // C3
    nodes.push(_pad(155.56, 'triangle', 0.025, 0.12, 0.010));  // Eb3
    nodes.push(_pad(196.00, 'sine', 0.020, 0.08, 0.008));      // G3
    // Very quiet high shimmer
    nodes.push(_pad(523.25, 'sine', 0.008, 0.25, 0.005));      // C5 shimmer
    return nodes.filter(Boolean);
  }

  function _buildLightning() {
    // Military urgency: staccato-ish square waves, faster pulse
    const nodes = [];
    nodes.push(_pad(146.83, 'square', 0.025, 3.0, 0.015));     // D3 pulsing
    nodes.push(_pad(174.61, 'square', 0.020, 3.5, 0.012));     // F3 pulsing
    nodes.push(_pad(220.00, 'sawtooth', 0.015, 2.0, 0.010));   // A3 buzz
    nodes.push(_pad(73.42, 'triangle', 0.030, 0.5, 0.018));    // D2 bass pulse
    return nodes.filter(Boolean);
  }

  function _buildBerkut() {
    // Aggressive heavy: low sawtooth drone, dissonant, rhythmic
    const nodes = [];
    nodes.push(_pad(55.00, 'sawtooth', 0.035, 0.8, 0.020));    // A1 heavy drone
    nodes.push(_pad(82.41, 'sawtooth', 0.025, 1.2, 0.015));    // E2 grind
    nodes.push(_pad(116.54, 'square', 0.020, 4.0, 0.018));     // Bb2 rapid pulse
    nodes.push(_pad(233.08, 'sine', 0.012, 0.3, 0.008));       // Bb3 high tension
    return nodes.filter(Boolean);
  }

  function _buildAkula() {
    // Deep underwater dread: very low sine pulses, sonar-like
    const nodes = [];
    nodes.push(_pad(36.71, 'sine', 0.040, 0.25, 0.025));       // D1 deep pulse
    nodes.push(_pad(55.00, 'triangle', 0.020, 0.6, 0.015));    // A1 undercurrent
    nodes.push(_pad(110.00, 'sine', 0.015, 1.5, 0.010));       // A2 sonar ping rhythm
    nodes.push(_pad(440.00, 'sine', 0.005, 0.08, 0.003));      // A4 distant ping
    return nodes.filter(Boolean);
  }

  function _buildNemesis() {
    // Dark mirror: dissonant tritone, pulsing, ominous
    const nodes = [];
    nodes.push(_pad(61.74, 'sawtooth', 0.030, 0.4, 0.020));    // B1 dark base
    nodes.push(_pad(87.31, 'triangle', 0.025, 0.7, 0.015));    // F2 tritone
    nodes.push(_pad(123.47, 'square', 0.018, 2.5, 0.012));     // B2 pulse
    nodes.push(_pad(174.61, 'sine', 0.010, 0.2, 0.008));       // F3 high dissonance
    return nodes.filter(Boolean);
  }

  const _trackBuilders = {
    ambient:   _buildAmbient,
    lightning: _buildLightning,
    berkut:    _buildBerkut,
    akula:     _buildAkula,
    nemesis:   _buildNemesis,
  };

  function musicSet(track) {
    if (track === _currentTrack) return;
    if (!_getCtx()) return;
    _stopTrack();
    _currentTrack = track;
    if (track === 'none' || !_trackBuilders[track]) return;
    _trackNodes = _trackBuilders[track]();
  }

  function musicStop() { musicSet('none'); }

  function musicCurrent() { return _currentTrack; }

  // ------------------------------------------------------------------ //
  // Public API surface
  // ------------------------------------------------------------------ //

  return Object.freeze({
    // Volume controls
    setVolume,
    mute,
    unmute,
    isMuted,

    // Gameplay sounds
    torpedoLaunch,
    torpedoSplash,
    torpedoHit,
    missileLaunch,
    missileIgnite,
    explodeSmall,
    explodeBig,
    damage,
    islandCrash,
    enemyDestroyed,
    gameOver,
    thrustPulse,
    thrustAir,
    thrustWater,
    waterSplash,
    waterBob,
    depthChargeSplash,
    dive,
    surface,
    disembark,
    embark,
    pickup,

    // Music system
    music: Object.freeze({
      set: musicSet,
      stop: musicStop,
      current: musicCurrent,
    }),
  });
})();
