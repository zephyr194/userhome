#!/bin/bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
tauri_dir="$(cd "$script_dir/.." && pwd)"
helper_dir="$tauri_dir/helper"
output_dir="$helper_dir/dist"
architectures="${USERHOME_HELPER_ARCHS:-arm64 x86_64}"

mkdir -p "$output_dir"

helper_inputs=()
bridge_inputs=()
for architecture in $architectures; do
  case "$architecture" in
    arm64|x86_64) ;;
    *)
      echo "Unsupported helper architecture: $architecture" >&2
      exit 1
      ;;
  esac

  triple="${architecture}-apple-macosx13.0"
  swiftpm_output_dir="$helper_dir/.build/${architecture}-apple-macosx/release"
  bridge_output_dir="$helper_dir/.build/$triple/release"
  mkdir -p "$bridge_output_dir"
  swift build \
    --package-path "$helper_dir" \
    --configuration release \
    --product UserHomeHelper \
    --triple "$triple"

  helper_binary="$swiftpm_output_dir/UserHomeHelper"
  bridge_binary="$bridge_output_dir/libUserHomeHelperBridge.dylib"
  swiftc \
    -parse-as-library \
    -emit-library \
    -O \
    -target "$triple" \
    -module-name UserHomeHelperBridge \
    -framework Foundation \
    -framework Security \
    -framework ServiceManagement \
    "$helper_dir/Sources/UserHomeHelper/Protocol.swift" \
    "$helper_dir/Sources/UserHomeHelper/Signing.swift" \
    "$helper_dir/Bridge/UserHomeHelperBridge.swift" \
    -o "$bridge_binary"

  helper_inputs+=("$helper_binary")
  bridge_inputs+=("$bridge_binary")
done

if [ "${#helper_inputs[@]}" -eq 1 ]; then
  cp "${helper_inputs[0]}" "$output_dir/UserHomeHelper"
  cp "${bridge_inputs[0]}" "$output_dir/libUserHomeHelperBridge.dylib"
else
  lipo -create "${helper_inputs[@]}" -output "$output_dir/UserHomeHelper"
  lipo -create "${bridge_inputs[@]}" -output "$output_dir/libUserHomeHelperBridge.dylib"
fi

chmod 0755 "$output_dir/UserHomeHelper" "$output_dir/libUserHomeHelperBridge.dylib"
lipo -archs "$output_dir/UserHomeHelper"
lipo -archs "$output_dir/libUserHomeHelperBridge.dylib"
