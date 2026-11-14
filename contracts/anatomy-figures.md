# Anatomy figures

Read this before building or embedding an interactive isometric figure with the `anatomy` skill.

For a figure that explains an idea as a real, working machine (an interactive isometric drawing
with a live readout), the vendored `anatomy` skill (`.claude/skills/anatomy/`, see its
`VENDORED.md`) builds it. Its figures are not blog diagrams, so the diagram rules in `CLAUDE.md` and the
`check` diagram tests do not apply inside one. Build the figure in `figures/<slug>/` (not in the
skill), then put it in a page with
`node .claude/skills/anatomy/scripts/embed.mjs figures/<slug>/<name>.html docs/<slug>.html --id <figure-id> --before <element-id>`.
Never paste a standalone figure page into `docs/`: its page CSS repaints the whole page and its
colours ignore the theme toggle. Details, and what to check afterwards, are in
`.claude/skills/anatomy/references/bitwise-blog.md`. Use one per page, and only where the machine
is the explanation.
