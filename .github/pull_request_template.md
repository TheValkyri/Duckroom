## Summary of Changes
<!-- Provide a concise description of what this PR introduces or modifies -->

### Type of Change
- [ ] `feat`: New feature or capability
- [ ] `fix`: Bug fix
- [ ] `refactor`: Code restructuring without behavior changes
- [ ] `perf`: Performance optimization
- [ ] `test`: Test suite addition or improvements
- [ ] `ci`: Build or workflow configuration
- [ ] `docs`: Documentation updates

---

## Release-Gate Quality Checklist
Before requesting review or merging, ensure all mandatory gates are verified:

- [ ] **Typecheck**: `npm run typecheck` passes with zero errors
- [ ] **Lint**: `npm run lint` passes with zero errors
- [ ] **Unit Tests**: `npm test` passes 100% of test suites
- [ ] **E2E Tests**: `npm run test:e2e` passes all Playwright smoke tests
- [ ] **Secret Scan**: `npm run scan:secrets` verifies zero credential leaks in client bundles
- [ ] **Production Build**: `npm run build` generates valid Vercel / Nitro distribution
- [ ] **Branch Protection**: PR is branched from and targeting protected `main` (no direct push)
- [ ] **Database / Schema (if applicable)**: Any SQL changes are reviewed, idempotent, and backward-compatible
