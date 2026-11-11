#!/usr/bin/env bash
# build-spec.sh — build a kramdown-rfc spec into the RFC XML v3 that vector reads.
#
#   scripts/build-spec.sh [--fetch] <spec.md>          write <dir>/<name>.xml beside the .md
#   scripts/build-spec.sh [--fetch] --check <spec.md>  rebuild to a temp file and diff it
#                                                      against the committed <dir>/<name>.xml
#
# Pipeline: kramdown-rfc spec.md > tmp.xml && xml2rfc --v2v3 tmp.xml -o spec.xml.
# kramdown-rfc on its own still writes v2 <texttable> for GFM tables, so the
# --v2v3 pass is what turns them into the v3 <table> vector reads. The result is
# then rendered with xml2rfc --text and --html into a temp dir (and thrown away)
# so a spec that the IETF tools cannot render never gets committed.
#
# Tool versions are pinned (below) and the script refuses to run with any other
# version: the committed XML is only reproducible with the exact tools that made it.
#
# Reference cache. kramdown-rfc 1.7.43 (lib/kramdown-rfc2629.rb) reads
#   KRAMDOWN_REFCACHEDIR  the cache directory (default ".refcache", relative to the cwd)
#   KRAMDOWN_OFFLINE      when set, never fetch: use the cached file whatever its age,
#                         and print "*** ... No such file" when it is missing
#   KRAMDOWN_REFCACHE_QUIET, KRAMDOWN_REFCACHETTL*, KRAMDOWN_REFCACHE_REFETCH
# This script points KRAMDOWN_REFCACHEDIR at the committed <repo>/.refcache and sets
# KRAMDOWN_OFFLINE, so a build reads only committed bytes and touches no network.
# Without OFFLINE kramdown-rfc would refetch any entry whose mtime is older than its
# TTL (7 days for RFCs) — and a fresh git checkout's mtimes are arbitrary, so the
# build would depend on the network and the day. A spec that cites a reference not
# yet in the cache fails; rerun once with --fetch (which drops OFFLINE so kramdown-rfc
# fetches the missing entries from bib.ietf.org into .refcache) and commit them.
# KRAMDOWN_SAFE is also set: it disables {::include …}, which would read arbitrary
# files (or URLs) into the build. xml2rfc runs with --no-network.
#
# Warnings are errors. Any kramdown-rfc line starting "*** " or "** " (unknown
# front-matter keys, unused sections, missing references, bad heading nesting) and
# any xml2rfc "Warning:" or "Error:" line fails the build. Two xml2rfc text-renderer
# warnings are silenced with its own --silence flag because they are cosmetic and
# unavoidable for a spec carrying a six-column vector table or a long property line:
# "Too long line found" and "Total table width". They change nothing in the XML.
#
# --check canonicalization. Both the rebuilt and the committed XML are reduced by
# removing exactly two kinds of markup, and nothing else:
#   - XML comments  <!-- … -->  (the generator banners, which name the Ruby
#     version, and kramdown-rfc's "##markdown-source" gzip+base64 comment);
#   - processing instructions  <? … ?>  (kramdown-rfc's <?line N?> markers and
#     <?xml-stylesheet?>). The XML declaration <?xml version=… ?> is not a
#     processing instruction and is kept.
# Comments and PIs inside <![CDATA[ … ]]> are text, not markup, and are kept.
# Whitespace: if removing them leaves a line holding only whitespace, that whole
# line (with its newline) is dropped; every other byte — indentation, newlines,
# whitespace before or after a removal on a line that keeps other content — is kept
# and compared exactly. A difference is printed as a unified diff and exits 1.
#
# Exit status: 0 built (or no drift); 1 drift, a tool error or warning, or a render
# failure; 2 usage error, missing input, or missing or wrong-version tools.
set -euo pipefail

readonly KRAMDOWN_RFC_VERSION="1.7.43"
readonly XML2RFC_VERSION="3.35.0"

usage() {
  echo "usage: scripts/build-spec.sh [--fetch] [--check] <spec.md>" >&2
  exit 2
}

check=0
fetch=0
spec=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) check=1 ;;
    --fetch) fetch=1 ;;
    -h | --help) usage ;;
    -*) echo "build-spec: unknown option $1" >&2; usage ;;
    *)
      [ -z "$spec" ] || { echo "build-spec: give exactly one spec.md" >&2; usage; }
      spec="$1"
      ;;
  esac
  shift
done
[ -n "$spec" ] || usage
case "$spec" in
  *.md) ;;
  *) echo "build-spec: $spec is not a .md file" >&2; exit 2 ;;
esac
[ -f "$spec" ] || { echo "build-spec: $spec: no such file" >&2; exit 2; }

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${spec%.md}.xml"

# Refuse to run with anything but the pinned tools, saying how to get them.
install_hint() {
  echo "  gem install kramdown-rfc -v $KRAMDOWN_RFC_VERSION --no-document" >&2
  echo "  pip install xml2rfc==$XML2RFC_VERSION" >&2
}
for tool in kramdown-rfc xml2rfc; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "build-spec: $tool is not installed; install the pinned tools:" >&2
    install_hint
    exit 2
  fi
done
have_kd="$(kramdown-rfc --version 2>/dev/null | awk '{print $2}')"
have_x2r="$(xml2rfc --version 2>/dev/null | awk '{print $2}')"
if [ "$have_kd" != "$KRAMDOWN_RFC_VERSION" ] || [ "$have_x2r" != "$XML2RFC_VERSION" ]; then
  echo "build-spec: need kramdown-rfc $KRAMDOWN_RFC_VERSION and xml2rfc $XML2RFC_VERSION, found kramdown-rfc ${have_kd:-?} and xml2rfc ${have_x2r:-?}; install the pinned tools:" >&2
  install_hint
  exit 2
fi

# The <date> defaults to the build day, which would make every rebuild on another
# day drift; require it pinned in the YAML front matter (before the first "--- ").
if ! awk 'NR > 1 && /^---/ { exit } /^date:[ \t]*[^ \t]/ { found = 1 } END { exit !found }' "$spec"; then
  echo "build-spec: $spec: front matter has no date: line; pin one (e.g. date: 2026-11-11) so rebuilds are reproducible" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Run a tool, keep its stderr, and fail if it printed anything we treat as an error.
# $1 is the regex of fatal lines; the rest is the command.
run_strict() {
  local fatal="$1"
  shift
  local status=0
  "$@" 2>"$tmp/stderr" || status=$?
  if [ "$status" -ne 0 ] || grep -Eq "$fatal" "$tmp/stderr"; then
    cat "$tmp/stderr" >&2
    echo "build-spec: $1 failed on $spec (exit $status); see the messages above" >&2
    exit 1
  fi
}

mkdir -p "$repo/.refcache"
kd_env=(env KRAMDOWN_REFCACHEDIR="$repo/.refcache" KRAMDOWN_SAFE=1 KRAMDOWN_REFCACHE_QUIET=1)
[ "$fetch" -eq 1 ] || kd_env+=(KRAMDOWN_OFFLINE=1)
# kramdown-rfc writes the XML to stdout; redirect in a subshell so run_strict sees stderr.
run_strict '^\*\*' sh -c '"$@" > "$0"' "$tmp/v2.xml" "${kd_env[@]}" kramdown-rfc "$spec"

x2r_quiet=(--no-network -s "Too long line found" -s "Total table width")
x2r_fatal='(Warning|Error):'
run_strict "$x2r_fatal" xml2rfc "${x2r_quiet[@]}" --v2v3 "$tmp/v2.xml" -o "$tmp/built.xml"
run_strict "$x2r_fatal" xml2rfc "${x2r_quiet[@]}" --text "$tmp/built.xml" -o "$tmp/built.txt"
run_strict "$x2r_fatal" xml2rfc "${x2r_quiet[@]}" --html "$tmp/built.xml" -o "$tmp/built.html"

if [ "$check" -eq 0 ]; then
  cp "$tmp/built.xml" "$out"
  echo "build-spec: wrote $out"
  exit 0
fi

[ -f "$out" ] || { echo "build-spec: $out: no committed XML to check; run scripts/build-spec.sh $spec" >&2; exit 1; }

# The canonicalization documented in the header. python3 is present wherever
# xml2rfc is; -I keeps it from importing anything from the cwd.
canonicalize() {
  python3 -I -c '
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
MARK = "\0"
pattern = re.compile(r"(<!\[CDATA\[.*?\]\]>)|<!--.*?-->|<\?(?!xml\s).*?\?>", re.S)
text = pattern.sub(lambda m: m.group(1) or MARK, text)
lines = text.split("\n")
kept = [l for l in lines if not (MARK in l and l.replace(MARK, "").strip() == "")]
sys.stdout.write("\n".join(kept).replace(MARK, ""))
' "$1"
}
canonicalize "$out" >"$tmp/committed.canon"
canonicalize "$tmp/built.xml" >"$tmp/rebuilt.canon"
if ! diff -u --label "$out (committed)" --label "$out (rebuilt from $spec)" \
  "$tmp/committed.canon" "$tmp/rebuilt.canon"; then
  echo "build-spec: $out is out of date with $spec; run scripts/build-spec.sh $spec and commit the result" >&2
  exit 1
fi
echo "build-spec: $out is up to date"
