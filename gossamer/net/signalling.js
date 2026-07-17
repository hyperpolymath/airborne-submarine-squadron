// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Jonathan D.A. Jewell (hyperpolymath) <j.d.a.jewell@open.ac.uk>
//
// signalling.js — WebRTC signalling over the existing Deno server's
// /room/:code endpoint. This module does not touch game state; it only
// brokers SDP offers / answers / ICE candidates between two browsers
// until a DataChannel is live. After that, the game uses the channel
// directly via net.js.
//
// Room code format: 6 uppercase alphanumerics, e.g. "X7HQ2K".
// Messages are POST'd as JSON; GET drains the mailbox.
//
// Flow:
//   HOST: createHost(code) -> {peerConnection, dataChannel, onOpen, onMessage}
//   JOIN: joinHost(code)   -> {peerConnection, dataChannel, onOpen, onMessage}
//
// Both sides emit typed events via EventTarget.

'use strict';

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const POLL_INTERVAL_MS = 700;

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

async function postBlob(code, blob) {
  const res = await fetch(`/room/${encodeURIComponent(code)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(blob),
  });
  if (!res.ok) throw new Error(`signalling POST ${code} failed: ${res.status}`);
  return res.json();
}

async function drainBox(code) {
  const res = await fetch(`/room/${encodeURIComponent(code)}`, { method: 'GET' });
  if (!res.ok) throw new Error(`signalling GET ${code} failed: ${res.status}`);
  return res.json();
}

// Wraps peer connection + channel with a simple event surface.
class Peer extends EventTarget {
  constructor(role /* 'host' | 'client' */) {
    super();
    this.role = role;
    this.pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    /** @type {RTCDataChannel|null} */
    this.channel = null;
    this._stopped = false;

    this.pc.oniceconnectionstatechange = () => {
      this.dispatchEvent(new CustomEvent('ice-state', { detail: this.pc.iceConnectionState }));
    };
  }

  _bindChannel(ch) {
    this.channel = ch;
    ch.onopen = () => this.dispatchEvent(new CustomEvent('open'));
    ch.onclose = () => this.dispatchEvent(new CustomEvent('close'));
    ch.onerror = (e) => this.dispatchEvent(new CustomEvent('error', { detail: e }));
    ch.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        this.dispatchEvent(new CustomEvent('message', { detail: parsed }));
      } catch (_) {
        // ignore malformed frames
      }
    };
  }

  send(obj) {
    if (this.channel && this.channel.readyState === 'open') {
      this.channel.send(JSON.stringify(obj));
    }
  }

  close() {
    this._stopped = true;
    try { if (this.channel) this.channel.close(); } catch (_) {}
    try { this.pc.close(); } catch (_) {}
  }
}

// HOST: creates offer + reliable DataChannel, pushes offer to the room,
// waits for an answer. Also polls for remote ICE candidates.
async function createHost(code) {
  const peer = new Peer('host');
  const pc = peer.pc;

  // Main reliable ordered channel (role claims, events, state).
  // Later we'll open a second unreliable unordered channel for inputs.
  const ch = pc.createDataChannel('main', { ordered: true });
  peer._bindChannel(ch);

  const pendingIce = [];
  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      postBlob(code, { kind: 'ice', from: 'host', candidate: ev.candidate.toJSON() })
        .catch(() => {});
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await postBlob(code, { kind: 'offer', sdp: pc.localDescription.toJSON() });

  // Poll for answer + remote ICE candidates
  (async function pollLoop() {
    let haveAnswer = false;
    while (!peer._stopped) {
      try {
        const blobs = await drainBox(code);
        for (const b of blobs) {
          if (b.kind === 'answer' && !haveAnswer) {
            await pc.setRemoteDescription(new RTCSessionDescription(b.sdp));
            haveAnswer = true;
            // Flush any ICE queued while we were waiting
            for (const c of pendingIce) {
              try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
            }
            pendingIce.length = 0;
          } else if (b.kind === 'ice' && b.from === 'client') {
            if (haveAnswer) {
              try { await pc.addIceCandidate(new RTCIceCandidate(b.candidate)); } catch (_) {}
            } else {
              pendingIce.push(b.candidate);
            }
          }
        }
      } catch (e) {
        // Transient — keep polling
      }
      if (peer.channel && peer.channel.readyState === 'open') break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  })();

  return peer;
}

// JOINER: reads offer from room, creates answer, posts it back, polls ICE.
async function joinHost(code) {
  const peer = new Peer('client');
  const pc = peer.pc;

  pc.ondatachannel = (ev) => peer._bindChannel(ev.channel);

  const pendingIce = [];
  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      postBlob(code, { kind: 'ice', from: 'client', candidate: ev.candidate.toJSON() })
        .catch(() => {});
    }
  };

  // Wait for the offer
  let gotOffer = false;
  const deadline = Date.now() + 20_000;
  while (!gotOffer && Date.now() < deadline && !peer._stopped) {
    try {
      const blobs = await drainBox(code);
      for (const b of blobs) {
        if (b.kind === 'offer' && !gotOffer) {
          await pc.setRemoteDescription(new RTCSessionDescription(b.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await postBlob(code, { kind: 'answer', sdp: pc.localDescription.toJSON() });
          gotOffer = true;
          // Flush any ICE queued
          for (const c of pendingIce) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
          }
          pendingIce.length = 0;
        } else if (b.kind === 'ice' && b.from === 'host') {
          if (gotOffer) {
            try { await pc.addIceCandidate(new RTCIceCandidate(b.candidate)); } catch (_) {}
          } else {
            pendingIce.push(b.candidate);
          }
        }
      }
    } catch (_) {}
    if (!gotOffer) await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  if (!gotOffer) throw new Error('Timed out waiting for host offer — check the room code');

  // Keep polling for ICE after the answer too
  (async function iceTrickle() {
    while (!peer._stopped) {
      try {
        const blobs = await drainBox(code);
        for (const b of blobs) {
          if (b.kind === 'ice' && b.from === 'host') {
            try { await pc.addIceCandidate(new RTCIceCandidate(b.candidate)); } catch (_) {}
          }
        }
      } catch (_) {}
      if (peer.channel && peer.channel.readyState === 'open') break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  })();

  return peer;
}

// Export to window for use from the lobby UI without modules.
window.ASSNet = Object.freeze({
  generateRoomCode,
  createHost,
  joinHost,
});
