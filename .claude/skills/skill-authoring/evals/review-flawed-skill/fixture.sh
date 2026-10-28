#!/usr/bin/env bash
# Builds a deliberately flawed skill in the workspace. Flaws: reserved word in name,
# first-person description over 1,024 characters, repo-root script path, a reference
# that links to another reference (two levels deep), a SKILL.md over 500 lines, no evals/.
set -euo pipefail
d=skills/claude-report-helper
mkdir -p "$d/references" "$d/scripts"
desc="I help you with reports. I can summarise test reports, build reports and coverage reports, and I will format them nicely for you whenever you ask."
while [ ${#desc} -lt 1150 ]; do desc="$desc I can also help with report-related tasks of many other kinds."; done
{
  echo "---"
  echo "name: claude-report-helper"
  echo "description: $desc"
  echo "---"
  echo
  echo "# Report helper"
  echo
  echo "Run the summariser with: node skills/claude-report-helper/scripts/summarise.mjs <file>"
  echo "Details are in [references/formats.md](references/formats.md)."
  echo
  for i in $(seq 1 520); do echo "- Rule $i: keep report line $i short and clear."; done
} > "$d/SKILL.md"
printf '# Formats\n\nSee [the other file](details.md) for column widths.\n' > "$d/references/formats.md"
printf '# Details\n\nColumn widths are 80.\n' > "$d/references/details.md"
printf 'console.log("summary");\n' > "$d/scripts/summarise.mjs"
