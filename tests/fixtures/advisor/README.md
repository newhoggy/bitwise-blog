# Advisor test fixtures

Everything here is invented. Wren Talavera and Ash Mercer are made-up writers, and no sentence comes
from any real corpus. Keep it that way: this repository is public, and these tests run in CI with no
private data (see `corpus/README.md`).

- `private/` has the same layout as `corpus/private`. Tests pass this directory's parent as `corpusRoot`.
- `goldens.json` records what the Python code at `shoulder-advisors@af0b407` does on these inputs and on
  the inputs listed in it. It was generated once by a tool in the private data repo. Do not edit it by hand.
