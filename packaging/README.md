# Packaging — Airborne Submarine Squadron

<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

Packaging manifests for the v3.0 multi-platform deployment roadmap.
These are scaffolding — the upstream builds still ship from `build.sh`
+ `run.js`; the files here drive downstream distro packaging only.

## Layout

```
packaging/
├── debian/            # .deb source (debhelper compat 13)
│   ├── control        # Package metadata, dependencies
│   ├── rules          # Build orchestration
│   └── launcher-stub  # /usr/games/ shim into /usr/share/
└── rpm/
    └── airborne-submarine-squadron.spec   # Fedora/RHEL/Rocky
```

For Windows, see `desktop/install.ps1` (PowerShell installer that
creates Start Menu + Desktop shortcuts).

## Building a .deb

Requires a Debian/Ubuntu build host with `debhelper` and either
`deno` or `nodejs`. From the repo root:

```bash
# Copy packaging/debian → debian/ for dpkg-buildpackage
cp -r packaging/debian .
dpkg-buildpackage -us -uc -b
# Resulting .deb appears one level up
ls ../airborne-submarine-squadron_*.deb
```

## Building an RPM

From the repo root on Fedora/RHEL/Rocky:

```bash
# Create the source tarball expected by the spec
git archive --format=tar.gz --prefix=airborne-submarine-squadron-0.5.0/ \
    -o ~/rpmbuild/SOURCES/v0.5.0.tar.gz HEAD
cp packaging/rpm/airborne-submarine-squadron.spec ~/rpmbuild/SPECS/
rpmbuild -ba ~/rpmbuild/SPECS/airborne-submarine-squadron.spec
ls ~/rpmbuild/RPMS/noarch/
```

## Installing on Windows

From PowerShell (no admin required — installs per-user):

```powershell
cd desktop
.\install.ps1          # Install shortcuts + icon
.\install.ps1 -Uninstall  # Remove everything
```

Runtime detection: the installer prefers `deno` but falls back to
`node`. If neither is on PATH, the shortcuts are still created and
will work once a runtime is installed. Install suggestions:

- `winget install DenoLand.Deno`
- `winget install OpenJS.NodeJS.LTS`

## Future platforms (v3.0)

The v3.0 roadmap targets these additional platforms; each needs its
own manifest or equivalent:

- **Kinoite/Silverblue** — Flatpak manifest (`org.hyperpolymath.AirborneSubmarineSquadron.yaml`)
- **macOS** — `.pkg` bundle via `pkgbuild` + `productbuild`
- **Android** — Cordova / Capacitor WebView wrapper
- **iOS** — WKWebView shell
- **Minix** — pkgsrc recipe
- **RISC-V** — verified via RISC-V Deno (prebuilt binaries available)
- **Lua / Node wrappers** — alternate runtimes for embedded contexts

Track progress in `ROADMAP.adoc` § v3.0 Multi-platform Deployment.
