# GitHub Packages Publishing Guide for Airborne Submarine Squadron

## Prerequisites

1. Node.js and npm installed
2. GitHub account with repository access
3. Personal Access Token (PAT) with `write:packages` scope

## Setup

### 1. Create a Personal Access Token

1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate a new token with `write:packages` scope
3. Copy the token (you won't be able to see it again)

### 2. Configure npm for GitHub Packages

Add the following to your `~/.npmrc` file:

```
//npm.pkg.github.com/:_authToken=YOUR_PERSONAL_ACCESS_TOKEN
@hyperpolymath:registry=https://npm.pkg.github.com
```

Replace `YOUR_PERSONAL_ACCESS_TOKEN` with the token you generated.

## Publishing the Package

### 1. Build the project

```bash
cd airborne-submarine-squadron
./build.sh
```

### 2. Login to npm (if not already logged in)

```bash
npm login --registry=https://npm.pkg.github.com
```

Use your GitHub username, the personal access token as password, and your email.

### 3. Publish the package

```bash
npm publish
```

This will publish your package to GitHub Packages under the `@hyperpolymath` scope.

## Installing the Package

To install this package in another project:

```bash
npm install @hyperpolymath/airborne-submarine-squadron
```

You'll need to configure npm to use GitHub Packages in that project as well.

## Versioning

This package uses semantic versioning. The current version is `0.1.0-alpha.1`.

To update the version before publishing:

```bash
npm version patch  # for bug fixes
npm version minor  # for new features
npm version major  # for breaking changes
```

## Notes

- The package includes WASM files, source code, and necessary scripts
- The package is configured to work with the npm registry on GitHub Packages
- You may need to adjust the `.npmignore` file if you want to include/exclude specific files
- The main entry point is `build/airborne-submarine-squadron.wasm`

## Troubleshooting

If you encounter authentication issues:
1. Verify your personal access token has the correct scopes
2. Check your `~/.npmrc` configuration
3. Try logging out and back in: `npm logout` then `npm login --registry=https://npm.pkg.github.com`

If you encounter publishing issues:
1. Make sure the version in package.json is unique (not already published)
2. Check that all required files exist in the specified locations
3. Verify your network connection can reach npm.pkg.github.com