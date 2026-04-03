// SPDX-License-Identifier: AGPL-3.0-or-later
// Simple WASM runner for Deno
// Usage: deno run --allow-read run_wasm.js [wasmFile] [functionName]

const wasmFile = Deno.args[0] || 'build/airborne-submarine-squadron.wasm';
const functionName = Deno.args[1] || 'main';

const wasmBuffer = await Deno.readFile(wasmFile);

const importObject = {
  wasi_snapshot_preview1: {
    fd_write: () => 0,
  },
};

try {
  const result = await WebAssembly.instantiate(wasmBuffer, importObject);
  const instance = result.instance;
  const exports = instance.exports;

  if (typeof exports[functionName] === 'function') {
    const returnValue = exports[functionName]();
    console.log(`${functionName}() returned: ${returnValue}`);
    Deno.exit(0);
  } else {
    console.error(`Function ${functionName} not found in exports`);
    Deno.exit(1);
  }
} catch (err) {
  console.error('Error:', err);
  Deno.exit(1);
}
