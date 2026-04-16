# Clone the repository
git clone https://github.com/hyperpolymath/airborne-submarine-squadron.git
cd airborne-submarine-squadron

# Using Nix (recommended for reproducibility)
nix develop

# Or using toolbox/distrobox
toolbox create airborne-submarine-squadron-dev
toolbox enter airborne-submarine-squadron-dev
# Install dependencies manually

# Verify setup
just check   # or: cargo check / mix compile / etc.
just test    # Run test suite
```

### Repository Structure
```
airborne-submarine-squadron/
├── src/                 # Source code (Perimeter 1-2)
├── lib/                 # Library code (Perimeter 1-2)
├── extensions/          # Extensions (Perimeter 2)
├── plugins/             # Plugins (Perimeter 2)
├── tools/               # Tooling (Perimeter 2)
├── docs/                # Documentation (Perimeter 3)
│   ├── architecture/    # ADRs, specs (Perimeter 2)
│   └── proposals/       # RFCs (Perimeter 3)
├── examples/            # Examples (Perimeter 3)
├── spec/                # Spec tests (Perimeter 3)
├── tests/               # Test suite (Perimeter 2-3)
├── .well-known/         # Protocol files (Perimeter 1-3)
├── .github/             # GitHub config (Perimeter 1)
│   ├── ISSUE_TEMPLATE/
│   └── workflows/
├── CHANGELOG.md
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md      # This file
├── GOVERNANCE.md
├── LICENSE
├── MAINTAINERS.md
├── README.adoc
├── SECURITY.md
├── flake.nix            # Nix flake (Perimeter 1)
└── justfile             # Task runner (Perimeter 1)
```

---

## How to Contribute

### Reporting Bugs

**Before reporting**:
1. Search existing issues
2. Check if it's already fixed in `main`
3. Determine which perimeter the bug affects

**When reporting**:

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) and include:

- Clear, descriptive title
- Environment details (OS, versions, toolchain)
- Steps to reproduce
- Expected vs actual behaviour
- Logs, screenshots, or minimal reproduction

### Suggesting Features

**Before suggesting**:
1. Check the [roadmap](ROADMAP.md) if available
2. Search existing issues and discussions
3. Consider which perimeter the feature belongs to

**When suggesting**:

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md) and include:

- Problem statement (what pain point does this solve?)
- Proposed solution
- Alternatives considered
- Which perimeter this affects

### Your First Contribution

Look for issues labelled:

- [`good first issue`](https://github.com/hyperpolymath/airborne-submarine-squadron/labels/good%20first%20issue) — Simple Perimeter 3 tasks
- [`help wanted`](https://github.com/hyperpolymath/airborne-submarine-squadron/labels/help%20wanted) — Community help needed
- [`documentation`](https://github.com/hyperpolymath/airborne-submarine-squadron/labels/documentation) — Docs improvements
- [`perimeter-3`](https://github.com/hyperpolymath/airborne-submarine-squadron/labels/perimeter-3) — Community sandbox scope

---

## Testing and Quality Assurance

### Running Tests

All tests are written in JavaScript/Deno and use `deno test` as the test runner.

**Run the full test suite (all categories):**
```bash
just test
# or directly:
deno test --allow-all test/
```

**Run specific test categories:**
```bash
just test-smoke          # Fast smoke tests (~30s) — quick gate before full suite
just test-unit           # Unit tests (pure game logic functions)
just test-contract       # Contract/invariant tests (K9 compliance checks)
just test-property       # Property-based tests (generative testing)
just test-mutation       # Mutation testing (code quality validation)
just test-fuzz           # Fuzz tests (adversarial inputs)
just test-regression     # Regression tests (locked bug fixes)
just test-compat         # Compatibility tests (file formats, schemas)
just test-chaos          # Chaos/resilience tests (failure modes)
just test-missions       # Mission-specific tests
just test-integration    # Integration tests (game state transitions, multi-system)
```

**Run performance benchmarks:**
```bash
just bench
# or directly:
deno bench --allow-all test/bench/gameloop_benchmark.js
```

### Test Suite Structure

The test suite is organized by classification:

| Category | Focus | Runtime | Location |
|----------|-------|---------|----------|
| **Smoke** | Fast gate (30s max) | <30s | `smoke_test.js` |
| **Unit** | Pure game logic | ~10s | `unit_test.js` |
| **Contract** | Invariants + K9 compliance | ~15s | `contract_test.js` |
| **Property** | Generative testing | ~20s | `property_test.js` |
| **Mutation** | Code quality | ~30s | `mutation_test.js` |
| **Fuzz** | Adversarial inputs | ~25s | `fuzz_test.js` |
| **Regression** | Locked bug fixes | ~10s | `regression_test.js` |
| **Compatibility** | File formats, schemas | ~10s | `compatibility_test.js` |
| **Chaos** | Failure modes, resilience | ~20s | `chaos_test.js` |
| **Mission** | Mission-specific logic | ~15s | `mission_test.js` |
| **Integration** | State machines, multi-system | ~20s | `integration_test.js` |

**Total estimated runtime: ~3 minutes for full suite**

### Code Coverage

We use **codecov** to track coverage across the project:

- **Target coverage: 80%+** for core game logic
- Coverage reports are uploaded automatically on every push to the `main` branch
- View coverage details: [codecov.io/gh/hyperpolymath/airborne-submarine-squadron](https://codecov.io/gh/hyperpolymath/airborne-submarine-squadron)

The CI workflow (`.github/workflows/test.yml`) automatically:
1. Runs all tests on Linux and macOS
2. Uploads coverage to codecov
3. Fails if coverage drops below 70%

### Test Categories Explained

#### Smoke Tests
Quick gate to catch obvious breakage. Run first, fastest. Used in pre-commit hooks.

**Example failures:** Parse errors, missing functions, immediate crashes.

#### Unit Tests
Pure game logic without I/O or rendering. Tests individual functions in isolation.

**Example coverage:**
- Thermal layer calculations (`getThermalLayer()`, `thermallyVisible()`)
- Damage mechanics (hull, weapons, thermal crush)
- Weapon system state (torpedoes, missiles, depth charges)
- Physics primitives (gravity, thrust, position updates)

#### Contract Tests
Verify game invariants using K9 contracts. Ensures consistency across state transitions.

**Example invariants:**
- Commander HP is always 0 ≤ HP ≤ MAX_HP
- Hull integrity always 0 ≤ Hull ≤ 1.0
- Thermal layer is in [-1, 0, 1, 2]
- Weapon counts never negative

#### Property Tests
Use generative testing (rapid-check style) to find edge cases.

**Example properties:**
- "For any valid input, position stays within world bounds"
- "After N damage hits, game ends"
- "Thermal layer transitions are monotonic"

#### Mutation Tests
Inject small code changes (mutations) and verify tests catch them.

**Example mutations:**
- Change `<` to `<=` in boundary checks
- Flip signs in physics calculations
- Swap mission types

Mutation tests verify the test suite itself is effective.

#### Fuzz Tests
Feed random/adversarial inputs and check for crashes.

**Example fuzzing:**
- Random (thrust, x, y, hp) tuples
- Extreme values (hull = -999, y = 2^31)
- Rapid state transitions

#### Regression Tests
Locked bug fixes. Prevent regression when refactoring.

**Example:**
```javascript
// Bug: thermal layer 1 sometimes returns -1
// Fix: added boundary check
// Locked test: verify with y = THERMAL_LAYER_1_MAX - 1
```

#### Compatibility Tests
File format reading, save/load, schema validation.

**Example coverage:**
- K9 coordination file parsing
- Mission serialization round-trip
- WASM artifact verification

#### Chaos Tests
Failure mode injection. Resilience and recovery testing.

**Current scenarios (`test/chaos_test.js`):**
- Port-conflict handling (all 6880-6884 occupied, `--reflect` still works)
- Concurrent launcher invocations (3× parallel `--reflect`)
- Missing WASM artifacts (`--reflect` reads registry, not build)
- Filesystem read stress (10× concurrent reads, identical content)
- VeriSimDB network-failure graceful degradation
- K9 file corruption (`--help` works regardless)
- Rapid startup/shutdown cycles (5× no orphans)
- Source file syntactic integrity (brace-balance sentinel)
- Damage penalty functions bounded under adversarial inputs
- `controls.js` read stress (20× reads, identical content)
- `SUB_SKINS` catalogue integrity (pride, rainbow, spectrum present)
- `createParts()` no shared-state leaks across 1000 invocations
- Script load order (`controls.js` before `persist.js` in `index_gossamer.html`)

#### Mission Tests
Mission-specific logic, state machines, completion conditions.

**Example scenarios:**
- Strike mission: spawn 8 nemeses, verify kill targets
- Hostage rescue: spawn 3 hostages, verify pickup range
- Escort: verify duration and damage thresholds
- Patrol: verify nemesis doesn't spawn

#### Integration Tests
Multi-system interactions, game state machines, full scenarios.

**Example scenarios:**
- Game initialization → patrol → strike mission → game over
- Thermal layer transitions (surface → warm → thermocline → deep)
- Hull damage progression (100% → 50% → 20% → crush death)
- Weapon firing with ammo depletion and state tracking

### Writing New Tests

When adding a feature, add tests to the appropriate category:

1. **Unit tests** — Test the new function in isolation
2. **Contract tests** — Add invariants if new state is introduced
3. **Integration tests** — Test interactions with other systems
4. **Regression tests** — Lock down any bugs found during development

**Test file template:**
```javascript
// SPDX-License-Identifier: AGPL-3.0-or-later
// your_test.js — Description of what you're testing

import { assertEquals, assert } from "jsr:@std/assert";
import extract from "./_extract.js";

const { constants: C, functions: F } = extract;

Deno.test("category: what you're testing", () => {
  // Arrange
  const game = new GameStateMachine();

  // Act
  game.doSomething();

  // Assert
  assertEquals(game.state.property, expectedValue);
});
```

### CI/CD Integration

GitHub Actions runs tests on every push and PR:

1. **test.yml** — Runs full blitz test suite on Linux + macOS
2. **codecov integration** — Uploads coverage automatically
3. **Required checks** — All tests must pass before merge

View workflow status: [Actions tab](https://github.com/hyperpolymath/airborne-submarine-squadron/actions)

---

## Development Workflow

### Branch Naming
```
docs/short-description       # Documentation (P3)
test/what-added              # Test additions (P3)
feat/short-description       # New features (P2)
fix/issue-number-description # Bug fixes (P2)
refactor/what-changed        # Code improvements (P2)
security/what-fixed          # Security fixes (P1-2)
```

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):
```
<type>(<scope>): <description>

[optional body]

[optional footer]
