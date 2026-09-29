# Product documentation instructions

Pages here are current user-facing truth. They are the only documents packaged as
product help, and packaged eligibility comes from `docs/catalog.json`.

- Keep claims accurate to shipped behavior in source and tests.
- Never describe planned or unverified capability as current.
- Every page needs a Chinese mirror under `docs/zh-CN/` with the same commands,
  configuration names, limits, and security boundaries.
- After changing a page, regenerate the packaged copy:
  `node scripts/build-doc-index.mjs`.
- Before submitting, run `CI=true pnpm check:docs`.
