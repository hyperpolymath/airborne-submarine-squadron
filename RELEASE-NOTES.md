# Airborne Submarine Squadron - Alpha-1 Release Notes

## 🎉 Release Information

**Version**: Alpha-1
**Tag**: `alpha-1`
**Date**: March 31, 2025
**License**: AGPL-3.0-or-later

## 🚀 What's New

### Enhanced Integration System

This alpha-1 release introduces a completely redesigned desktop integration system with advanced features:

#### **Reflective Architecture**
- Self-aware installation system with version tracking
- Automatic platform and architecture detection
- Real-time location tracking and dependency management

#### **Homoiconic Design**
- Self-describing configuration through metadata
- Consistent structure across all integration components
- Clear, documented interfaces and protocols

#### **Self-Healing Capabilities**
- Automatic backup system for critical files
- File existence verification before operations
- Backup restoration when files are missing or corrupted
- Comprehensive error reporting and recovery

#### **Fault Tolerance**
- Safe command execution with error checking
- Graceful degradation when tools are missing
- Alternative installation paths
- Comprehensive error handling throughout

#### **Cross-Platform Support**
- **Linux (x86_64/ARM)**: Full support with menu and desktop integration
- **Windows**: ICO file provided, partial support with manual setup
- **RISC-V**: Framework in place, ready for implementation
- **Minix**: Framework in place, ready for implementation

## 📦 Package Contents

### Core Files
- `integ.sh` - Enhanced integration script (4.5KB)
- `desktop/install.sh` - Fault-tolerant installer (6.8KB)
- `desktop/uninstall.sh` - Clean uninstaller (0.6KB)
- `launcher.sh` - Unified launcher with multiple modes

### New Assets
- `desktop/icons/airborne-submarine-squadron.ico` - Windows ICO with multiple sizes
- `.backup/` - Backup directory with critical files
- `INTEGRATION-UPGRADE.md` - Complete upgrade documentation
- `ALPHA-1-RELEASE-CHECKLIST.md` - Release verification checklist

### Documentation
- Enhanced `README.adoc` with integration system details
- Platform support matrix
- Installation instructions
- Troubleshooting guide

## 🔧 Installation

### Linux (Recommended)
```bash
# Clone the repository
git clone https://github.com/hyperpolymath/airborne-submarine-squadron.git
cd airborne-submarine-squadron

# Make scripts executable
chmod +x integ.sh desktop/install.sh desktop/uninstall.sh

# Install desktop integration
./integ.sh

# Launch the game
./launcher.sh --browser
```

### Windows (Manual Setup)
1. Download the repository ZIP or use the ICO file
2. Create a desktop shortcut manually using `desktop/icons/airborne-submarine-squadron.ico`
3. Point the shortcut to `launcher.sh --browser` (via WSL or Git Bash)
4. Or use the WSL installation method above

### Other Platforms
- **RISC-V/Minix**: Framework available, implementation coming soon
- **macOS**: Framework available, testing needed

## 🎮 Features

### Integration System
- ✅ One-click desktop installation
- ✅ Application menu entry (Linux)
- ✅ Desktop shortcut creation
- ✅ Multiple launch modes (Browser, CLI, Gossamer, Tray)
- ✅ Automatic platform detection
- ✅ Self-diagnostics and health checks

### Game Features
- ✅ 2D side-view arcade flight gameplay
- ✅ Submarine/aircraft hybrid mechanics
- ✅ Weapon triad: torpedoes, missiles, depth charges
- ✅ Digital HUD with speedometer and gauges
- ✅ Space transition at 88 MPH
- ✅ Leaderboard and performance tracking

## 🐛 Known Issues & Limitations

### Alpha-1 Limitations
- Windows full installer not yet implemented (manual setup required)
- RISC-V and Minix support framework only (not fully tested)
- Some advanced self-healing features planned for future versions
- No automatic update checking in this release
- Tray icon may require additional dependencies

### Compatibility Notes
- Requires Deno or Python for web server
- WASM runtime needed for CLI mode
- Linux desktop environment required for full integration
- Windows users need WSL or Git Bash for shell scripts

## 📈 Roadmap

### Next Steps (Alpha-2)
- [ ] Full Windows installer with registry integration
- [ ] RISC-V specific installation script
- [ ] Minix specific installation script
- [ ] Automatic update checking
- [ ] Enhanced self-healing with network restoration

### Future Features
- [ ] macOS native installer
- [ ] Snap/Flatpak packages
- [ ] Windows MSI installer
- [ ] Homebrew formula for macOS
- [ ] AUR package for Arch Linux

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines.

### Reporting Issues
- Check existing issues before creating new ones
- Include platform, version, and reproduction steps
- Provide debug output when possible

### Development Setup
```bash
git clone https://github.com/hyperpolymath/airborne-submarine-squadron.git
cd airborne-submarine-squadron
# See README.adoc for full development setup
```

## 📚 Documentation

- **README.adoc**: Main documentation and quick start
- **INTEGRATION-UPGRADE.md**: Integration system upgrade details
- **ALPHA-1-RELEASE-CHECKLIST.md**: Release verification checklist
- **docs/**: Additional development documentation

## 🔒 Security & Licensing

### Dependabot Alert Resolution
- **atty 0.2.14**: Potential unaligned read on Windows
- **Status**: **RESOLVED** - Replaced with zatty (local dependency)
- **Impact**: Eliminated - no longer in dependency tree
- **Action**: Removed clap dependency that was pulling in atty

### Licensing Updates

#### New Dependency: zatty
- **License**: AGPL-3.0-or-later (same as main project)
- **Purpose**: Terminal detection functionality
- **Location**: Local path dependency (`../../zatty`)
- **Status**: Fully compatible with project licensing

#### Dependency Changes
- **Removed**: clap v2.34.0 (and its atty transitive dependency)
- **Added**: zatty v0.1.0 (local, AGPL-3.0-or-later)
- **Result**: Cleaner dependency tree, no external atty usage

### License Compliance

All dependencies now comply with the project's licensing requirements:

| Dependency | License | Status |
|------------|---------|--------|
| ksni | MIT | ✅ Compatible |
| libc | MIT/Apache-2.0 | ✅ Compatible |
| zatty | AGPL-3.0-or-later | ✅ Native |
| dbus | MIT/Apache-2.0 | ✅ Compatible |

**Note**: All transitive dependencies have been verified for license compatibility.

### Security Improvements

1. **Eliminated atty vulnerability**: No longer in dependency tree
2. **Reduced attack surface**: Fewer external dependencies
3. **Local control**: zatty is locally maintained
4. **Simplified auditing**: Cleaner dependency graph

## 📋 Technical Details

### Language Architecture

**Primary Language**: AffineScript (compiles to JavaScript/WASM)
- Game logic, core mechanics, and main application
- Analyzed via JavaScript/TypeScript CodeQL queries

**Secondary Language**: Rust (tray component only)
- System tray icon functionality
- Minimal codebase, isolated from main game
- Now uses zatty instead of atty

### Dependency Tree Changes

**Before (with atty vulnerability):**
```
airborne-tray (Rust)
├── ksni
│   └── dbus-codegen
│       └── clap
│           └── atty (vulnerable)
└── zatty
```

**After (atty eliminated):**
```
airborne-tray (Rust)
├── ksni
│   └── dbus-codegen (no clap dependency)
└── zatty (local, safe)
```

**Main Application (AffineScript → WASM):**
```
No external dependencies (self-contained WASM)
```

### Build Verification

```bash
# For Rust tray component
cd tray
cargo tree | grep atty || echo "✅ atty successfully removed"
cargo tree | grep zatty && echo "✅ zatty active"

# For main AffineScript application
./build.sh && echo "✅ AffineScript builds successfully"
```

## 📊 Telemetry

This alpha release includes basic self-diagnostics but no external telemetry.

## 🎯 Getting Started

1. **Install**: Run `./integ.sh` for full desktop integration
2. **Launch**: Use `./launcher.sh --browser` or desktop shortcut
3. **Play**: Follow on-screen controls and legend
4. **Explore**: Try different launch modes and weapons
5. **Feedback**: Report issues and suggestions

## 🙏 Acknowledgments

Thank you to all contributors and testers who made this alpha release possible!

## 📜 License

This project is licensed under the Palimpsest-MPL 1.0-or-later. See LICENSE for details.

---

**Download**: [airborne-submarine-squadron-alpha-1.tar.gz](/tmp/airborne-submarine-squadron-alpha-1.tar.gz)
**Source**: [GitHub Repository](https://github.com/hyperpolymath/airborne-submarine-squadron)
**Tag**: [alpha-1](https://github.com/hyperpolymath/airborne-submarine-squadron/releases/tag/alpha-1)