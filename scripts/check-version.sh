#!/usr/bin/env sh
# 校验版本号一致：package.json（唯一事实来源）· tauri.conf.json · src-tauri/Cargo.toml · Cargo.lock
# 用法：scripts/check-version.sh [vX.Y.Z]（带参数时同时校验 git tag）
set -eu
cd "$(dirname "$0")/.."

fail() { echo "::error::$1" >&2; exit 1; }

pkg_ver="$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')"
conf_ver="$(python3 -c 'import json; print(json.load(open("src-tauri/tauri.conf.json"))["version"])')"
cargo_ver="$(python3 -c '
import re, sys
s = open("src-tauri/Cargo.toml").read()
m = re.search(r"^\[package\]$(.*?)(?=^\[|\Z)", s, re.M | re.S)
if not m: sys.exit("no [package] section in Cargo.toml")
v = re.search(r"^version\s*=\s*\"([^\"]*)\"", m.group(1), re.M)
if not v: sys.exit("no version in [package]")
print(v.group(1))
')"
lock_ver="$(python3 -c '
import re, sys
s = open("src-tauri/Cargo.lock").read()
m = re.search(r"^\[\[package\]\]\nname = \"ink-writer\"\nversion = \"([^\"]*)\"", s, re.M)
if not m: sys.exit("no ink-writer package in Cargo.lock")
print(m.group(1))
')"

echo "$pkg_ver" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "package.json 版本号格式非法：$pkg_ver"
[ "$conf_ver" = "$pkg_ver" ] || fail "tauri.conf.json ($conf_ver) ≠ package.json ($pkg_ver)"
[ "$cargo_ver" = "$pkg_ver" ] || fail "Cargo.toml ($cargo_ver) ≠ package.json ($pkg_ver)"
[ "$lock_ver" = "$pkg_ver" ] || fail "Cargo.lock ($lock_ver) ≠ package.json ($pkg_ver)"

if [ $# -gt 0 ]; then
  tag="$1"
  tag="${tag#v}"
  [ "$tag" = "$pkg_ver" ] || fail "tag ($1) ≠ package.json ($pkg_ver)"
fi
echo "version OK: $pkg_ver"
