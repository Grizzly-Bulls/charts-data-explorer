# Contributing

Thanks for contributing to Charts Data Explorer. We prefer small, understandable changes that improve a concrete developer use case.

1. Read [AGENTS.md](AGENTS.md) for the source, rights and security boundaries.
2. Use Node.js 24 and run `npm run check` before opening a PR. No dependencies are required.
3. Add a synthetic offline regression test for any new parsing, pagination, error, visualization or security behavior.
4. Never commit API keys, customer data, snapshots scraped from financial data vendors, or live source response dumps.
5. Keep all published copy accurate: observation dates are not source-release dates, and missing values must not be manufactured.
6. Work through the published Charts API. New data families must be approved upstream; do not hard-code an alternative allowlist to broaden this demo.

Report security issues privately through the Grizzly Bulls website contact channel rather than publishing exploit details in a public issue.
