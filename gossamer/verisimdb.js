// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// verisimdb.js — VeriSimDB integration for Airborne Submarine Squadron.
// Provides async persistence for leaderboard, settings, and crash logs.
// Falls back to localStorage when VeriSimDB is unavailable.
//
// VeriSimDB is the hyperpolymath database — mandatory per project policy.
// Instance: http://localhost:8080 (development)

/* global localStorage */

const VERISIMDB_URL = 'http://localhost:8080';
const VERISIMDB_NAMESPACE = 'airborne-submarine-squadron';
const VERISIMDB_TIMEOUT = 2000;  // 2s timeout — don't block the game

// ── Connection state ────────────────────────────────────────────────
let verisimdbAvailable = null; // null = untested, true/false after probe

async function verisimdbProbe() {
  if (verisimdbAvailable !== null) return verisimdbAvailable;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERISIMDB_TIMEOUT);
    const res = await fetch(`${VERISIMDB_URL}/health`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timer);
    verisimdbAvailable = res.ok;
  } catch {
    verisimdbAvailable = false;
  }
  if (verisimdbAvailable) {
    console.log('[VeriSimDB] Connected to', VERISIMDB_URL);
  } else {
    console.log('[VeriSimDB] Not available — using localStorage fallback');
  }
  return verisimdbAvailable;
}

// ── Generic store/retrieve ──────────────────────────────────────────

async function verisimdbPut(collection, key, data) {
  if (!verisimdbAvailable) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERISIMDB_TIMEOUT);
    const res = await fetch(`${VERISIMDB_URL}/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        namespace: VERISIMDB_NAMESPACE,
        collection,
        key,
        data,
        timestamp: new Date().toISOString(),
      }),
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function verisimdbGet(collection, key) {
  if (!verisimdbAvailable) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERISIMDB_TIMEOUT);
    const res = await fetch(
      `${VERISIMDB_URL}/query?namespace=${VERISIMDB_NAMESPACE}&collection=${collection}&key=${key}`,
      { signal: controller.signal, headers: { 'Accept': 'application/json' } }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const result = await res.json();
    return Array.isArray(result) && result.length > 0 ? result[0].data : result.data || null;
  } catch {
    return null;
  }
}

// ── Leaderboard ─────────────────────────────────────────────────────

async function verisimdbSaveLeaderboard(entries) {
  // Always save to localStorage (primary)
  try { localStorage.setItem('ass_leaderboard', JSON.stringify(entries)); } catch {}
  // Mirror to VeriSimDB
  await verisimdbPut('leaderboard', 'entries', entries);
}

async function verisimdbLoadLeaderboard() {
  // Try VeriSimDB first
  const remote = await verisimdbGet('leaderboard', 'entries');
  if (remote && Array.isArray(remote)) return remote;
  // Fall back to localStorage
  try {
    const local = localStorage.getItem('ass_leaderboard');
    return local ? JSON.parse(local) : [];
  } catch { return []; }
}

// ── Settings ────────────────────────────────────────────────────────

async function verisimdbSaveSettings(settings) {
  try { localStorage.setItem('ass_settings', JSON.stringify(settings)); } catch {}
  await verisimdbPut('settings', 'current', settings);
}

async function verisimdbLoadSettings() {
  const remote = await verisimdbGet('settings', 'current');
  if (remote && typeof remote === 'object') return remote;
  try {
    const local = localStorage.getItem('ass_settings');
    return local ? JSON.parse(local) : null;
  } catch { return null; }
}

// ── Crash logs ──────────────────────────────────────────────────────

async function verisimdbLogCrash(crashData) {
  // Always save to localStorage
  try {
    const logs = JSON.parse(localStorage.getItem('ass_crash_logs') || '[]');
    logs.push(crashData);
    if (logs.length > 20) logs.shift();
    localStorage.setItem('ass_crash_logs', JSON.stringify(logs));
  } catch {}
  // Mirror to VeriSimDB with timestamp key
  const key = `crash-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await verisimdbPut('crash_logs', key, crashData);
}

// ── Game state snapshots ────────────────────────────────────────────

async function verisimdbSaveGame(gameState) {
  try { localStorage.setItem('ass_save', JSON.stringify(gameState)); } catch {}
  await verisimdbPut('saves', 'autosave', gameState);
}

async function verisimdbLoadGame() {
  const remote = await verisimdbGet('saves', 'autosave');
  if (remote && typeof remote === 'object') return remote;
  try {
    const local = localStorage.getItem('ass_save');
    return local ? JSON.parse(local) : null;
  } catch { return null; }
}

// ── Mission results ─────────────────────────────────────────────────

async function verisimdbRecordMission(result) {
  const key = `mission-${Date.now()}`;
  await verisimdbPut('missions', key, {
    ...result,
    timestamp: new Date().toISOString(),
  });
}

// ── Init: probe on load ─────────────────────────────────────────────
verisimdbProbe();
