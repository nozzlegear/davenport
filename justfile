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
    #!/usr/bin/env bash
    set -e
    CONF_DIR=$(mktemp -d /tmp/davenport-docker-config.XXXXXX)
    cleanup() {
        echo "Cleaning up..."
        rm -rf "$CONF_DIR"
        just cleanup-test-containers
    }
    trap cleanup EXIT
    DOCKER_CONFIG="$CONF_DIR" TESTCONTAINERS_RYUK_PRIVILEGED=true npm test

# Run tests in watch mode
[group("test")]
test-watch:
    #!/usr/bin/env bash
    set -e
    CONF_DIR=$(mktemp -d /tmp/davenport-docker-config.XXXXXX)
    cleanup() {
        echo "Cleaning up..."
        rm -rf "$CONF_DIR"
        just cleanup-test-containers
    }
    trap cleanup EXIT
    DOCKER_CONFIG="$CONF_DIR" TESTCONTAINERS_RYUK_PRIVILEGED=true npm run test:watch

# Cleanup any lingering test containers
[group("test")]
cleanup-test-containers:
    @docker ps -a --filter "name=davenport-test-" --format "{{"{{.ID}}"}}" | xargs -r docker rm -f

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

# Publish the package to NPM or Github
[group("release")]
[script]
[arg("platform", pattern="npm|github")]
publish-package platform:
    if [ "{{platform}}" = "github" ]; then
        npm pkg set name="@nozzlegear/davenport"
        # Github does not support provenance or staged publishing at this time
        npm publish --registry https://npm.pkg.github.com --no-provenance
    else
        npm pkg set name="davenport"
        npm stage publish
    fi
