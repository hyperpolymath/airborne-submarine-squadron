// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Jonathan D.A. Jewell (hyperpolymath)
//
// camera_layers.js — Shared camera-space world-layer helpers.
// Keeps sky/water/ground extents camera-aware so deep dives do not expose
// unfilled bands between layers.

(function initCameraLayerHelpers(globalScope) {
  "use strict";

  function computeViewBounds(cameraY, viewportHeight, overscan) {
    const pad = Number.isFinite(overscan) ? overscan : 140;
    return {
      viewTop: cameraY - pad,
      viewBottom: cameraY + viewportHeight + pad,
    };
  }

  function computeSkyTop(viewTop, minSkyTop) {
    const minTop = Number.isFinite(minSkyTop) ? minSkyTop : -200;
    return Math.min(minTop, viewTop);
  }

  function computeWaterBottom(viewBottom, seaFloor, seaFloorMargin) {
    const floor = Number.isFinite(seaFloor) ? seaFloor : 0;
    const margin = Number.isFinite(seaFloorMargin) ? seaFloorMargin : 100;
    return Math.max(floor + margin, viewBottom);
  }

  function computeWorldLayerBounds(cameraY, viewportHeight, options) {
    const opts = options || {};
    const view = computeViewBounds(cameraY, viewportHeight, opts.overscan);
    return {
      viewTop: view.viewTop,
      viewBottom: view.viewBottom,
      skyTop: computeSkyTop(view.viewTop, opts.minSkyTop),
      waterBottom: computeWaterBottom(view.viewBottom, opts.seaFloor, opts.seaFloorMargin),
    };
  }

  const api = Object.freeze({
    computeViewBounds,
    computeSkyTop,
    computeWaterBottom,
    computeWorldLayerBounds,
  });

  if (!globalScope.GossamerCameraLayers) {
    globalScope.GossamerCameraLayers = api;
  }
})((typeof window !== "undefined") ? window : globalThis);
