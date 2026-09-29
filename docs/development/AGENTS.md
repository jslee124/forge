# Development documentation instructions

Pages here are contributor navigation, evaluation, and roadmap material. They are
development contracts, not shipped-behavior declarations, and they are not
packaged as product help.

- A plan records intent; established completion comes from source, tests, and
  recorded acceptance results.
- Link evidence under `evals/reports/<version>/` instead of restating results.
- When work completes, archive the plan under `history/<version>/` with a
  historical role banner and update `docs/catalog.json`.
- Before submitting, run `CI=true pnpm check:docs`.
