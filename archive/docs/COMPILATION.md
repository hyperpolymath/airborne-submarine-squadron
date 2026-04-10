# Compilation Instructions

## Method 1: Using AffineScript Compiler

### Prerequisites
```bash
sudo dnf install ocaml opam dune
opam init
opam install menhir ppx_deriving
```

### Build Steps
```bash
# Clone AffineScript
git clone https://github.com/affinescript/affinescript.git
cd affinescript

# Build compiler
dune build

# Compile game
./_build/default/bin/affinescript compile \
  ~/airborne-game/src/main_final_working.affine \
  -o ~/airborne-game/wasm/airborne-final-working.wasm
```

## Method 2: Using Docker

### Docker Setup
```bash
# Build Docker image
docker build -t affinescript .

# Compile in container
docker run -v ~/airborne-game:/game affinescript \
  compile /game/src/main_final_working.affine \
  -o /game/wasm/airborne-final-working.wasm
```

## Method 3: Pre-compiled Binary

### Download Pre-built
```bash
# Download from releases
wget https://github.com/affinescript/affinescript/releases/latest/affinescript-linux
chmod +x affinescript-linux

# Compile
./affinescript-linux compile \
  ~/airborne-game/src/main_final_working.affine \
  -o ~/airborne-game/wasm/airborne-final-working.wasm
```

## Troubleshooting

### Missing Dependencies
```bash
# Install OCaml dependencies
opam install menhir ppx_deriving yojson ctypes

# Install system dependencies
sudo dnf install bubblewrap gcc make
```

### Compilation Errors
- **Parse error**: Check syntax (semicolons, braces)
- **Type error**: Verify type annotations
- **Undefined variable**: Check function order

### WASM Issues
```bash
# Validate WASM
wasm-validate airborne-final-working.wasm

# Optimize WASM
wasm-opt -O3 airborne-final-working.wasm -o optimized.wasm
```

## Verification

### Check Compilation
```bash
# Verify WASM file
file airborne-final-working.wasm

# Check WASM exports
wasm2wat airborne-final-working.wasm | grep export
```

### Test in Browser
```bash
# Start server
python3 -m http.server 8000

# Open browser
firefox http://localhost:8000

# Check console
F12 > Console tab
```
