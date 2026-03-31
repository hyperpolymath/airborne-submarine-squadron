// Simple WASM runner for Node.js
const fs = require('fs');

const wasmFile = process.argv[2] || 'build/airborne-submarine-squadron.wasm';
const functionName = process.argv[3] || 'main';

const wasmBuffer = fs.readFileSync(wasmFile);

let importObject = {
  wasi_snapshot_preview1: {
    fd_write: () => 0,
  },
};

let wasi = null;
try {
  const { WASI } = require('wasi');
  wasi = new WASI({ args: [], env: {}, preopens: {} });
  importObject = { ...statePushImport, wasi_snapshot_preview1: wasi.wasiImport };
} catch (_) {
  // Fallback to stubbed fd_write if WASI isn't available.
}

WebAssembly.instantiate(wasmBuffer, importObject).then(result => {
  const instance = result.instance;
  if (wasi) {
    wasi.initialize(instance);
  }

  const exports = instance.exports;
  if (typeof exports[functionName] === 'function') {
    const returnValue = exports[functionName]();
    console.log(`${functionName}() returned: ${returnValue}`);
    process.exit(0);
  } else {
    console.error(`Function ${functionName} not found in exports`);
    process.exit(1);
  }
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
