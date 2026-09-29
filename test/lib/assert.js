// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// assert.js — the handful of assertion helpers the suite uses, on bun:test's expect
// (so failures keep bun's structural diffs).  Replaces the retired jsr:@std/assert import.

import { expect } from "bun:test";

function withMsg(fn, msg) {
  try { fn(); } catch (e) { if (msg) e.message = `${msg}\n${e.message}`; throw e; }
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "Assertion failed");
}
export function assertEquals(actual, expected, msg) { withMsg(() => expect(actual).toEqual(expected), msg); }
export function assertNotEquals(actual, expected, msg) { withMsg(() => expect(actual).not.toEqual(expected), msg); }
export function assertGreater(actual, expected, msg) { withMsg(() => expect(actual).toBeGreaterThan(expected), msg); }
export function assertLess(actual, expected, msg) { withMsg(() => expect(actual).toBeLessThan(expected), msg); }
export function assertGreaterOrEqual(actual, expected, msg) { withMsg(() => expect(actual).toBeGreaterThanOrEqual(expected), msg); }
export function assertLessOrEqual(actual, expected, msg) { withMsg(() => expect(actual).toBeLessThanOrEqual(expected), msg); }
export function assertThrows(fn, msg) { withMsg(() => expect(fn).toThrow(), msg); }
