# SPDX-License-Identifier: AGPL-3.0-or-later
# RPM spec for Airborne Submarine Squadron.
#
# Tested against:
#   - Fedora 39, 40, 41
#   - RHEL 9 / Rocky 9 (via EPEL deno)
#
# Build:    rpmbuild -ba airborne-submarine-squadron.spec
# Install:  dnf install airborne-submarine-squadron-*.noarch.rpm

%global pkgname airborne-submarine-squadron
%global pkgver  0.5.0
%global pkgdir  /usr/share/%{pkgname}

Name:           %{pkgname}
Version:        %{pkgver}
Release:        1%{?dist}
Summary:        Sopwith-style flying submarine arcade game

License:        AGPL-3.0-or-later
URL:            https://github.com/hyperpolymath/%{pkgname}
Source0:        %{url}/archive/refs/tags/v%{version}.tar.gz

BuildArch:      noarch
BuildRequires:  desktop-file-utils

# Runtime — deno preferred, node.js as fallback
Requires:       (deno >= 2.0 or nodejs >= 18)
Recommends:     xdg-utils
Suggests:       wasmtime

%description
Airborne Submarine Squadron is a browser-forward take on the classic
Sopwith-style arcade, built on the Gossamer launcher. Features
atmosphere flight, underwater combat with thermal layers and
caterpillar drive, orbital space navigation, three ship types, two
enemy submarine classes, mine chain-cutting, supply drops, hangar
defence, and a commander ejection system.

The game runs in a modern browser via a Deno-served file server
(port 6880) or as a Gossamer desktop variant. A prebuilt WASM
module ships; the AffineScript source is also included for
reproducible rebuilds.

%prep
%autosetup -n %{pkgname}-%{version}

%build
# Prefer the prebuilt WASM shipped in build/; fall back to affinescript
# if AFFINESCRIPT_REPO is set on the build host.
bash build.sh

%install
install -d %{buildroot}%{pkgdir}
cp -r gossamer src build dist run.js launcher.sh package.json \
    %{buildroot}%{pkgdir}/

# Launcher stub
install -d %{buildroot}%{_bindir}
cat > %{buildroot}%{_bindir}/%{pkgname} <<EOF
#!/bin/sh
exec %{pkgdir}/launcher.sh "\$@"
EOF
chmod 0755 %{buildroot}%{_bindir}/%{pkgname}

# Desktop entry + icons
install -Dm0644 desktop/%{pkgname}.desktop \
    %{buildroot}%{_datadir}/applications/%{pkgname}.desktop
install -Dm0644 desktop/icons/%{pkgname}.png \
    %{buildroot}%{_datadir}/icons/hicolor/256x256/apps/%{pkgname}.png
install -Dm0644 desktop/icons/%{pkgname}.svg \
    %{buildroot}%{_datadir}/icons/hicolor/scalable/apps/%{pkgname}.svg

%check
# Run headless tests if deno is available on the builder.
if command -v deno >/dev/null 2>&1; then \
    deno test --allow-all test/ ; \
else \
    echo "deno not found — skipping test suite" >&2 ; \
fi

%files
%license LICENSE
%doc README.adoc ROADMAP.adoc
%{_bindir}/%{pkgname}
%{pkgdir}
%{_datadir}/applications/%{pkgname}.desktop
%{_datadir}/icons/hicolor/256x256/apps/%{pkgname}.png
%{_datadir}/icons/hicolor/scalable/apps/%{pkgname}.svg

%changelog
* Thu Apr 16 2026 Jonathan D.A. Jewell <j.d.a.jewell@open.ac.uk> - 0.5.0-1
- Initial RPM spec for v0.5.0 alpha
- Includes v2.1 Customization Layer (skin presets, damage refinement,
  warp preview, astrocompass HUD)
- Ships prebuilt WASM; source included for reproducible rebuilds
