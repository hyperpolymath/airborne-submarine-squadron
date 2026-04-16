# Build Chain — Airborne Submarine Squadron

<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

The game ships a **prebuilt WASM bundle** in `build/` (with legacy copies in
`dist/` and `build/airborne-final-working.wasm`) so casual playtesters
never need the AffineScript toolchain. Contributors modifying
`src/main.affine` do need it, but the build script degrades gracefully
in all three scenarios below.

## Build scenarios

| Scenario | What runs | Outcome |
|----------|-----------|---------|
| 1. `affinescript` on PATH | Native compile (`affinescript compile src/main.affine --wasm-gc`) | Fresh WASM |
| 2. `AFFINESCRIPT_REPO=/path/to/checkout` | Runs `_build/default/bin/main.exe` or `dune exec affinescript` from the checkout | Fresh WASM |
| 3. Neither present | Falls back to `dist/airborne-submarine-squadron.wasm` → `build/airborne-final-working.wasm` | Reused prebuilt WASM |

`build.sh` always exits 0 if any path produced a valid artifact. Only a
completely empty `dist/` + `build/` combination will cause a non-zero
exit (and that's checked in CI — see `.github/workflows/build-chain.yml`).

## How to rebuild from source

Assuming the AffineScript compiler is present:

```bash
# Option A: PATH-installed affinescript
./build.sh

# Option B: development checkout
AFFINESCRIPT_REPO=/var/mnt/eclipse/repos/nextgen-languages/affinescript ./build.sh

# Option C: auto-discover sibling checkout (looks two levels up)
mkdir -p ../nextgen-languages
git clone https://github.com/hyperpolymath/affinescript ../nextgen-languages/affinescript
./build.sh
```

The script searches (in order):

1. `$AFFINESCRIPT_REPO`
2. `../nextgen-languages/affinescript` (sibling of this repo)
3. `../../nextgen-languages/affinescript` (two up)
4. `/var/mnt/eclipse/repos/nextgen-languages/affinescript` (hyperpolymath workstation default)

## Toolchain versions

Match the upstream [affinescript](https://github.com/hyperpolymath/affinescript) pin:

- OCaml >= 4.14
- Dune >= 3.8
- `wasm-tools` (optional, for `--wasm-gc` validation)

On the target runtime side:

- **Deno** >= 2.0 (preferred) — used by `run.js` + test suite
- **Node.js** >= 18 (fallback) — smoke path
- **Modern browser** — Chromium 100+, Firefox 100+, Safari 15+

## Verifying the WASM

```bash
# Magic bytes: 00 61 73 6d (\x00asm)
xxd build/airborne-submarine-squadron.wasm | head -1

# Run the WASM module directly
deno run --allow-all run.js --gossamer    # Full game
wasmtime build/airborne-submarine-squadron.wasm     # CLI mode
```

## Reproducibility

`build.sh` is deterministic given an identical AffineScript compiler
and source tree. The CI `Build Chain` workflow enforces:

- Scenario 3 (prebuilt fallback) always succeeds
- WASM magic bytes match
- `run.js --reflect` produces valid JSON
- `build.sh` documents the fallback (grep sentinel)
- README mentions `AFFINESCRIPT_REPO` and the prebuilt fallback

If you change any of those invariants, update both the workflow and
this file.

## Packaging

See `packaging/README.md` for `.deb` / `.rpm` / Windows installer
builds, and `desktop/install.sh` / `desktop/install.ps1` for the
system-integration steps.
