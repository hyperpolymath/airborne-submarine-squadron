# Airborne Submarine Squadron alpha candidate 0.1.0

## Artifact
- `release/airborne-submarine-squadron-alpha-v0.1.0.tar.gz` (includes `build/`, `gossamer/`, `tray/`, `docs/`, launcher scripts + WASM outputs)

## GitHub package release
1. Tag the release locally (if not already tagged): `git tag -s v0.1.0-alpha -m "Airborne Submarine Squadron alpha"`
2. Push the tag: `git push origin v0.1.0-alpha`
3. Create the GitHub release with the artifact:
   ```sh
   gh release create v0.1.0-alpha \
     --title "Airborne Submarine Squadron alpha candidate" \
     --notes-file release/alpha-candidate-release.md \
     release/airborne-submarine-squadron-alpha-v0.1.0.tar.gz
   ```
   (Adjust `gh` args if you need to upload multiple assets or add changelog text.)

## Other forges / federated hosts
- For GitLab: `glab release create v0.1.0-alpha --notes-file release/alpha-candidate-release.md release/airborne-submarine-squadron-alpha-v0.1.0.tar.gz`.
- For SourceHut: `git push https://git.sr.ht/~<user>/airborne-submarine-squadron v0.1.0-alpha && qualquer` (upload tarball via `suj` or release notes / issue referencing artifact). Provide download link to tarball hosted on repo releases or `https://<host>/files/airborne-submarine-squadron-alpha-v0.1.0.tar.gz`.
- For other registries (ForgeFS, package indexes), use the same tarball and release note; note that verifying signatures or checksums before upload helps (see `sha256sum release/airborne-submarine-squadron-alpha-v0.1.0.tar.gz`).

## Verification steps
1. `tar -xzf release/airborne-submarine-squadron-alpha-v0.1.0.tar.gz -C /tmp/asq` and inspect `README.adoc` and `build/` artifacts.
2. Run the desktop launcher: `./launcher.sh gossamer` or the WASM harness: `node run_wasm.js build/airborne-submarine-squadron.wasm main`.
3. Smoke test the tray helper: `./tray/tray` (if built) and confirm HUD assets still load from `gossamer/`.

## Changelog highlights
- Captures deterministic WASM builds from `build/` and supporting HUD assets in `gossamer/`.
- Self-contained executable scripts (`launcher.sh`, `run_wasm*.js`, `tray/`) ensure cross-platform double-run support.
- Documented in release notes for reuse across GitHub, GitLab, and allied forges.
