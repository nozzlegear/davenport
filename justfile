# https://just.systems

# Dotnet verbosity
verbosity := "minimal"

default:
    just --list

# Build the project
[group("build")]
build:
    npm run build

# Run tests
[group("test")]
test:
    npm test

# Lint and format
[group("lint")]
lint:
    npm run lint

[group("lint")]
format:
    npm run format

# Set package version
[group("release")]
[script]
set-package-version version:
    npm version "{{version}}" --no-git-tag-version

# Publish to NPM
[group("release")]
[script]
publish-to-npm:
    npm stage publish

