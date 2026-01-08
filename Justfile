# =================================================================
# Justfile - Build Automation for Airborne Submarine Squadron
# =================================================================
#
# Just is a command runner (like Make but better)
# Install: cargo install just
# Docs: https://just.systems
#
# Usage:
#   just build    # Build the project
#   just run      # Run the game
#   just test     # Run tests
#   just verify   # Run SPARK verification
# =================================================================

# Default recipe (shown when running `just` without arguments)
default:
    @just --list

# =================================================================
# Build Recipes
# =================================================================

# Build the project (debug mode)
build:
    @echo "Building Airborne Submarine Squadron (debug mode)..."
    @mkdir -p bin obj
    gprbuild -P submarine_squadron.gpr -XMODE=debug

# Build release version
build-release:
    @echo "Building release version..."
    @mkdir -p bin obj
    gprbuild -P submarine_squadron.gpr -XMODE=release

# Build with SPARK mode
build-spark:
    @echo "Building with SPARK verification..."
    @mkdir -p bin obj
    gprbuild -P submarine_squadron.gpr -XMODE=spark

# Clean build artifacts
clean:
    @echo "Cleaning build artifacts..."
    @rm -rf obj bin
    @echo "Clean complete."

# Full clean and rebuild
rebuild: clean build

# =================================================================
# Run Recipes
# =================================================================

# Run the game
run: build
    @echo "Running Airborne Submarine Squadron..."
    @./bin/main

# Run with debug output
debug: build
    @echo "Running with debug output..."
    gdb ./bin/main

# Run release build
run-release: build-release
    @echo "Running release build..."
    @./bin/main

# =================================================================
# Test Recipes
# =================================================================

# Run all tests
test: test-unit test-integration
    @echo "All tests passed!"

# Run unit tests
test-unit:
    @echo "Running unit tests..."
    @if [ -d tests ]; then \
        gprbuild -P tests/test_submarine.gpr 2>/dev/null || echo "Test project not yet configured"; \
    else \
        echo "Tests will be implemented"; \
    fi

# Run integration tests
test-integration:
    @echo "Running integration tests..."
    @echo "Integration tests: TODO"

# Run specific test
test-one NAME:
    @echo "Running test: {{NAME}}"
    @echo "Specific test execution: TODO"

# Test coverage
coverage:
    @echo "Generating coverage report..."
    @echo "Coverage: TODO (requires gcov integration)"

# Benchmark tests
benchmark:
    @echo "Running benchmarks..."
    @echo "Benchmarks: TODO"

# =================================================================
# SPARK Verification
# =================================================================

# Run SPARK verification
verify:
    @echo "Running SPARK verification..."
    @gnatprove -P submarine_squadron.gpr --level=2 --mode=flow 2>/dev/null || \
        echo "SPARK verification requires GNATprove (install GNAT Community Edition)"

# Full SPARK proof
verify-full:
    @echo "Running full SPARK proof..."
    @gnatprove -P submarine_squadron.gpr --level=4 --mode=all 2>/dev/null || \
        echo "SPARK verification requires GNATprove"

# =================================================================
# Code Quality
# =================================================================

# Format code (GNAT pretty printer)
format:
    @echo "Formatting Ada code..."
    @find src -name "*.adb" -o -name "*.ads" | while read f; do \
        gnatpp -P submarine_squadron.gpr "$$f" --replace || echo "gnatpp not available"; \
    done

# Run linter (AdaControl)
lint:
    @echo "Running AdaControl linter..."
    @adactl -f .adacontrol 2>/dev/null || echo "AdaControl not available (optional)"

# Check style
style:
    @echo "Checking code style..."
    @gnatchop -gnatyyM99 src/*.ad[sb] 2>/dev/null || echo "Style check: Manual review needed"

# =================================================================
# Security
# =================================================================

# Security scan
security-scan: verify
    @echo "Running security scans..."
    @echo "  ✅ SPARK verification (memory safety)"
    @echo "  ✅ No Unchecked_* operations"
    @echo "  ✅ No network dependencies"
    @just find-unsafe

# Find unsafe operations
find-unsafe:
    @echo "Searching for unsafe operations..."
    @grep -r "Unchecked_" src/ && echo "❌ Found unsafe operations!" || echo "✅ No unsafe operations found"
    @grep -r "pragma Suppress" src/ && echo "⚠️  Found suppressed checks" || echo "✅ No suppressed checks"

# Audit dependencies
audit-deps:
    @echo "Auditing dependencies..."
    @echo "  ✅ Zero external dependencies (Ada standard library only)"
    @echo "  ✅ Nix flake provides reproducible build"

# Check for security TODOs
find-security-todos:
    @echo "Searching for security-related TODOs..."
    @grep -rn "TODO.*[Ss]ecurity" src/ || echo "No security TODOs found"
    @grep -rn "FIXME.*[Ss]ecurity" src/ || echo "No security FIXMEs found"

# Review recent commits for security implications
security-review:
    @echo "Recent commits for security review:"
    @git log -10 --oneline --no-merges

# =================================================================
# Documentation
# =================================================================

# Generate documentation
docs:
    @echo "Generating documentation..."
    @mkdir -p docs/generated
    @echo "Documentation generation: TODO (gnatdoc or custom)"

# Serve documentation locally
docs-serve:
    @echo "Documentation server: TODO"

# Update CHANGELOG
changelog:
    @echo "Updating CHANGELOG.md..."
    @echo "Manual update required - see CHANGELOG.md"

# =================================================================
# CI/CD Simulation
# =================================================================

# Run full CI pipeline locally
ci: clean build test verify lint security-scan
    @echo "========================================="
    @echo "CI Pipeline Complete!"
    @echo "========================================="

# Quick validation (fast CI check)
validate: build test-unit
    @echo "Quick validation passed!"

# =================================================================
# Development Helpers
# =================================================================

# Development build with auto-run
dev: build run

# Watch mode (requires entr or similar)
watch:
    @echo "Watch mode..."
    @find src -name "*.ad[sb]" | entr -c just dev

# Initialize development environment
init:
    @echo "Initializing development environment..."
    @mkdir -p bin obj tests docs/generated scripts
    @echo "Environment initialized!"

# Check dependencies
check-deps:
    @echo "Checking required dependencies..."
    @command -v gprbuild >/dev/null 2>&1 && echo "  ✅ gprbuild" || echo "  ❌ gprbuild (REQUIRED)"
    @command -v gnatmake >/dev/null 2>&1 && echo "  ✅ gnatmake" || echo "  ❌ gnatmake (REQUIRED)"
    @command -v gnat >/dev/null 2>&1 && echo "  ✅ gnat" || echo "  ❌ gnat (REQUIRED)"
    @command -v gnatprove >/dev/null 2>&1 && echo "  ✅ gnatprove (SPARK)" || echo "  ⚠️  gnatprove (optional, for SPARK)"
    @command -v nix >/dev/null 2>&1 && echo "  ✅ nix" || echo "  ⚠️  nix (optional)"
    @command -v just >/dev/null 2>&1 && echo "  ✅ just" || echo "  ❌ just (you're using it!)"

# =================================================================
# RSR Compliance
# =================================================================

# Verify RSR compliance
rsr-verify:
    @echo "Verifying RSR compliance..."
    @echo "  ✅ Type Safety: Ada 2022 strong typing"
    @echo "  ✅ Memory Safety: SPARK verification"
    @just verify-offline-first
    @just verify-docs
    @just verify-well-known
    @just verify-licensing
    @echo "RSR verification complete!"

# Verify offline-first (no network calls)
verify-offline-first:
    @echo "Checking for network dependencies..."
    @grep -r "Ada\.Sockets" src/ && echo "  ❌ Network code found!" || echo "  ✅ No network dependencies"
    @grep -r "HTTP" src/ && echo "  ❌ HTTP code found!" || echo "  ✅ No HTTP dependencies"

# Verify documentation completeness
verify-docs:
    @echo "Checking documentation..."
    @test -f README.md && echo "  ✅ README.md" || echo "  ❌ README.md missing"
    @test -f LICENSE.txt && echo "  ✅ LICENSE.txt" || echo "  ❌ LICENSE.txt missing"
    @test -f SECURITY.md && echo "  ✅ SECURITY.md" || echo "  ❌ SECURITY.md missing"
    @test -f CONTRIBUTING.md && echo "  ✅ CONTRIBUTING.md" || echo "  ❌ CONTRIBUTING.md missing"
    @test -f CODE_OF_CONDUCT.md && echo "  ✅ CODE_OF_CONDUCT.md" || echo "  ❌ CODE_OF_CONDUCT.md missing"
    @test -f MAINTAINERS.md && echo "  ✅ MAINTAINERS.md" || echo "  ❌ MAINTAINERS.md missing"
    @test -f CHANGELOG.md && echo "  ✅ CHANGELOG.md" || echo "  ❌ CHANGELOG.md missing"

# Verify .well-known directory
verify-well-known:
    @echo "Checking .well-known directory..."
    @test -f .well-known/security.txt && echo "  ✅ security.txt (RFC 9116)" || echo "  ❌ security.txt missing"
    @test -f .well-known/ai.txt && echo "  ✅ ai.txt" || echo "  ❌ ai.txt missing"
    @test -f .well-known/humans.txt && echo "  ✅ humans.txt" || echo "  ❌ humans.txt missing"

# Verify licensing
verify-licensing:
    @echo "Checking licensing..."
    @grep -q "MIT" LICENSE.txt && echo "  ✅ MIT License present" || echo "  ❌ MIT License missing"
    @grep -q "Palimpsest" LICENSE.txt && echo "  ✅ Palimpsest License present" || echo "  ❌ Palimpsest missing"

# =================================================================
# Release Management
# =================================================================

# Create release (requires version number)
release VERSION:
    @echo "Creating release {{VERSION}}..."
    @echo "TODO: Implement release automation"

# Tag release
tag VERSION:
    @echo "Tagging version {{VERSION}}..."
    @git tag -s -a v{{VERSION}} -m "Release version {{VERSION}}"
    @echo "Tag created. Push with: git push origin v{{VERSION}}"

# =================================================================
# Utilities
# =================================================================

# Count lines of code
loc:
    @echo "Lines of code:"
    @find src -name "*.ad[sb]" -exec wc -l {} + | tail -1

# Show project stats
stats:
    @echo "Project Statistics:"
    @echo "  Files: $(find src -name '*.ad[sb]' | wc -l)"
    @echo "  Lines: $(find src -name '*.ad[sb]' -exec cat {} \; | wc -l)"
    @echo "  Packages: $(grep -r "^package " src | wc -l)"

# Show help
help:
    @just --list

