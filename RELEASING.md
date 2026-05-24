# Releasing FlowPane

This document outlines the process for cutting a new release of FlowPane.

## 1. Version Bumping

Bumping the version must be done in two places simultaneously:

1. `package.json`: Update the `"version"` field.
2. `src-tauri/tauri.conf.json`: Update the `"version"` field in the root object.

Example:
```bash
# Bump to 1.0.0
npm version 1.0.0 --no-git-tag-version
# Manually update tauri.conf.json
```

## 2. Code Signing

### macOS
To sign the macOS application, you need an Apple Developer Certificate and a dedicated App Password for notarization.

Required Environment Variables (in GitHub Actions Secrets):
- `APPLE_CERTIFICATE`: Base64 encoded `.p12` certificate.
- `APPLE_CERTIFICATE_PASSWORD`: Password for the `.p12` file.
- `APPLE_ID`: Your Apple ID email.
- `APPLE_TEAM_ID`: Your Apple Team ID.

### Windows
Windows apps should be signed with an Authenticode certificate to avoid SmartScreen warnings.

Manual step (if not in CI):
```powershell
signtool sign /fd sha256 /tr http://ts.ssl.com /td sha256 /f MyCert.pfx /p MyPassword FlowPane.exe
```

## 3. Triggering the Release

Once versions are bumped and changes committed:

1. Create a git tag: `git tag -a v1.0.0 -m "Release v1.0.0"`
2. Push the tag: `git push origin v1.0.0`

GitHub Actions will automatically start the "Build and Release" workflow.

## 4. Manual Verification Required

Before marking a release as "Final" on GitHub:

- [ ] **Windows**: Test the NSIS installer on a clean Windows 10/11 machine. Verify that transparency/acrylic effect works.
- [ ] **Linux**: Test the AppImage on a distro without a compositor (e.g., bare X11) to ensure the fallback/warning works.
- [ ] **macOS**: Ensure the `.dmg` is correctly notarized (should not show "Malicious Software" warning).
- [ ] **All**: Check that "About" shows the correct version and "Privacy Policy" opens.

## 5. Post-Release

- Update `CHANGELOG.md` to move items from `[Unreleased]` to the new version section.
- Verify the release artifacts on GitHub.
