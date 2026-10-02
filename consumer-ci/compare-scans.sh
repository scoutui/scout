#!/usr/bin/env bash
# Compare two scan artefacts of the same repo, BEFORE and AFTER a change.
# Usage: consumer-ci/compare-scans.sh [--expect FILE] BEFORE.json AFTER.json
#
# Every component row and every occurrence's call site (filePath:line:column) is
# keyed by identity:
#   package-export|packageName|publicEntry|exportName
#   repository-declaration|repoId|filePath|exportName
#   tag|tagName
#   unresolved:<reason kind>                           (an unresolved occurrence)
# A site holds one key per occurrence, so a key credited twice there counts twice.
# Where a key's count at a site drops, the key is lost there; where it rises, it
# is gained. Several keys are joined with " + ".
#
# Prints the moved sites as `lost -> gained` groups with site counts, where (lost)
# and (new) mark a site missing on one side and (none) nothing lost or gained at
# a surviving site. Then prints the differences, and exits 1 on any difference:
#   lost-site <site> <keys>                  a BEFORE site missing from AFTER
#   reattributed <lost> -> <gained> <sites>  surviving sites that lost a key, including to unresolved
#   lost-row <key>                           a BEFORE row missing from AFTER
# New sites, new rows and keys gained at a site that lost none never fail.
#
# --expect FILE lists explained differences in that same line format. Blank lines
# and lines starting with # are skipped, and a reattributed line without a site
# count matches any count. The script exits 0 only when every difference is
# listed, and prints the expect lines that matched nothing or repeat an earlier
# line. Exit 2: bad usage or an unknown expect line.

set -euo pipefail
export LC_ALL=C

usage() {
  echo "usage: $0 [--expect FILE] BEFORE.json AFTER.json" >&2
  exit 2
}

B='' A='' EXPECT=/dev/null
while [[ $# -gt 0 ]]; do
  case $1 in
    --expect) [[ $# -ge 2 ]] || usage; EXPECT=$2; shift 2 ;;
    -*) usage ;;
    *)
      if [[ -z $B ]]; then B=$1; elif [[ -z $A ]]; then A=$1; else usage; fi
      shift
      ;;
  esac
done
[[ -n $B && -n $A ]] || usage
[[ -r $EXPECT ]] || { echo "$0: cannot read expect file $EXPECT" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# One line per row ("R", key) and one per occurrence ("S", site, key).
EXTRACT='
def key:
  if .kind == "package-export" then "package-export|\(.packageName)|\(.publicEntry)|\(.exportName)"
  elif .kind == "repository-declaration" then "repository-declaration|\(.repoId)|\(.filePath)|\(.exportName)"
  else "tag|\(.tagName)" end;
(.components | map({key: .id, value: (.identity | key)}) | from_entries) as $keys
| (.components[] | "R\t\(.identity | key)"),
  (.occurrences[]
    | .resolution as $r
    | "S\t\(.filePath):\(.line):\(.column)\t" + (
        if $r.status == "resolved" then $keys[$r.componentId] // "missing-component:\($r.componentId)"
        else "unresolved:\($r.reason.kind)" end))'

extract() {
  : > "$2.rows"; : > "$2.pairs"
  jq -r "$EXTRACT" "$1" | awk -F'\t' -v p="$2" '
    $1 == "R" { print $2 > (p ".rows") }
    $1 == "S" { print $2 "\t" $3 > (p ".pairs") }'
  sort -u "$2.rows" > "$2.rows-set"
  sort "$2.pairs" > "$2.pairs-sorted"
}
count() { wc -l < "$1" | tr -d ' '; }
sites() { cut -f1 "$1" | uniq | wc -l | tr -d ' '; }

extract "$B" "$TMP/b"
extract "$A" "$TMP/a"
comm -23 "$TMP/b.rows-set" "$TMP/a.rows-set" > "$TMP/rows-lost"
comm -13 "$TMP/b.rows-set" "$TMP/a.rows-set" > "$TMP/rows-new"

# "lost<TAB>gained<TAB>site" for every site whose keys differ. A site's keys
# arrive sorted, so each list holds a key's repeats next to each other.
awk -F'\t' -v OFS='\t' '
  function joined(list) { gsub(/\n/, " + ", list); return list }
  function surplus(site, list, mine, other,    keys, n, i, extra, out) {
    n = split(list, keys, "\n"); out = ""
    for (i = 1; i <= n; i++) {
      if (i > 1 && keys[i] == keys[i - 1]) continue
      for (extra = mine[site, keys[i]] - other[site, keys[i]]; extra > 0; extra--) out = out == "" ? keys[i] : out " + " keys[i]
    }
    return out == "" ? "(none)" : out
  }
  FILENAME == ARGV[1] { if ($1 in before) before[$1] = before[$1] "\n" $2; else before[$1] = $2; countBefore[$1, $2]++; next }
  { if ($1 in after) after[$1] = after[$1] "\n" $2; else after[$1] = $2; countAfter[$1, $2]++ }
  END {
    for (site in before) {
      if (!(site in after)) print joined(before[site]), "(lost)", site
      else if (before[site] != after[site]) print surplus(site, before[site], countBefore, countAfter), surplus(site, after[site], countAfter, countBefore), site
    }
    for (site in after) if (!(site in before)) print "(new)", joined(after[site]), site
  }' "$TMP/b.pairs-sorted" "$TMP/a.pairs-sorted" | sort -t $'\t' -k3,3 > "$TMP/moves"

{
  awk -F'\t' '$1 != "(new)" && $1 != "(none)" && $2 != "(lost)" { n[$1 " -> " $2]++ }
    END { for (g in n) print "reattributed " g " " n[g] }' "$TMP/moves" | sort
  awk -F'\t' '$2 == "(lost)" { print "lost-site " $3 " " $1 }' "$TMP/moves"
  sed 's/^/lost-row /' "$TMP/rows-lost"
} > "$TMP/differences"

awk -v unexplained="$TMP/unexplained" -v unused="$TMP/unused" '
  function split_count(line) {
    count = ""
    if (line ~ /^reattributed / && match(line, / [0-9]+$/)) { count = substr(line, RSTART + 1); line = substr(line, 1, RSTART - 1) }
    return line
  }
  FILENAME == ARGV[1] {
    line = $0; sub(/^[ \t]+/, "", line); sub(/[ \t\r]+$/, "", line)
    if (line == "" || line ~ /^#/) next
    if (line !~ /^(lost-site|reattributed|lost-row) /) { print ARGV[1] ":" FNR ": unknown expect line: " $0 | "cat 1>&2"; bad = 1; next }
    text = line; line = split_count(line)
    if (line in want) { repeats[FNR] = text; first[FNR] = where[line] }
    else { want[line] = count; where[line] = FNR }
    next
  }
  {
    line = split_count($0)
    if ((line in want) && (want[line] == "" || want[line] == count)) used[line] = 1
    else print > unexplained
  }
  END {
    printf "" > unexplained; printf "" > unused
    for (line in want) if (!(line in used)) printf "%6d: %s%s\n", where[line], line, (want[line] == "" ? "" : " " want[line]) > unused
    for (n in repeats) printf "%6d: %s (repeats line %d)\n", n, repeats[n], first[n] > unused
    exit bad ? 2 : 0
  }' "$EXPECT" "$TMP/differences" || exit 2

echo "rows: $(count "$TMP/b.rows") -> $(count "$TMP/a.rows") ($(count "$TMP/rows-lost") lost, $(count "$TMP/rows-new") new)"
echo "occurrences: $(count "$TMP/b.pairs") -> $(count "$TMP/a.pairs")"
echo "sites: $(sites "$TMP/b.pairs-sorted") -> $(sites "$TMP/a.pairs-sorted") ($(awk -F'\t' '
  $2 == "(lost)" { lost++; next }
  $1 == "(new)" { gained++; next }
  $1 != "(none)" { moved++ }
  END { printf "%d lost, %d re-attributed, %d new", lost, moved, gained }' "$TMP/moves"))"

if [[ -s "$TMP/moves" ]]; then
  echo "--- moved sites: sites, lost -> gained"
  awk -F'\t' '{ n[$1 " -> " $2]++ } END { for (g in n) printf "%7d  %s\n", n[g], g }' "$TMP/moves" | sort -k1,1nr -k2
fi
if [[ -s "$TMP/rows-new" ]]; then
  echo "--- new rows: $(count "$TMP/rows-new"), first 40"
  head -40 "$TMP/rows-new"
fi

DIFFERENCES=$(count "$TMP/differences")
UNEXPLAINED=$(count "$TMP/unexplained")
if [[ $EXPECT == /dev/null ]]; then
  [[ $DIFFERENCES -eq 0 ]] || echo "--- differences: $DIFFERENCES"
else
  echo "--- differences: $DIFFERENCES, not in $EXPECT: $UNEXPLAINED"
fi
cat "$TMP/unexplained"
if [[ -s "$TMP/unused" ]]; then
  echo "--- expect lines that matched nothing or repeat an earlier line: $(count "$TMP/unused")"
  sort -n "$TMP/unused"
fi

if [[ $UNEXPLAINED -gt 0 ]]; then
  echo "FAIL: $UNEXPLAINED unexplained differences"
  exit 1
elif [[ $DIFFERENCES -eq 0 ]]; then
  echo "OK: no lost site, re-attributed site or lost row"
else
  echo "OK: every difference is in the expect file"
fi
