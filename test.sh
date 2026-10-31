#!/usr/bin/env sh

set -e

./build.sh
npx @webxdc/webxdc-dev run app.xdc
