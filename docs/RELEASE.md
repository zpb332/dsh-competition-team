# Release checklist

## Before tagging

- [ ] `node --test` — all green (currently 63 tests)
- [ ] `npm pack --dry-run` — confirm `lib/`, `docs/images/`, `README.en.md`, `CHANGELOG.md` are in the tarball
- [ ] `git status` — no `.dsh-competition/`, `node_modules/`, logs, or personal paths
- [ ] Version in `package.json` matches `CHANGELOG.md`
- [ ] `README.md` and `README.en.md` screenshots render
- [ ] DSH version in the README matches the one you tested

## First publish

```bash
git init
git add .
git commit -m "feat: competition team plugin v0.2.0"
git branch -M main
git remote add origin https://github.com/ZPB332/dsh-competition-team.git
git push -u origin main
git tag -a v0.2.0 -m "v0.2.0 beta"
git push origin v0.2.0
```

Then on GitHub:

- [ ] Create the `v0.2.0` release from the tag, paste the `0.2.0` section of `CHANGELOG.md`
- [ ] Add topics: `dsh`, `dsh-plugin`, `agent-teams`, `competition`, `multi-agent`
- [ ] Confirm the `test` workflow ran on Ubuntu and Windows
- [ ] Pin the repo description to the one-liner from `README.md`

## After publishing

- [ ] Watch install issues first; they are the most common early report
- [ ] Ask reporters for DSH version, OS, and `team.json` shape
- [ ] Keep the DSH compatibility range honest; bump it only after testing

## Not ready for

- npm publish (`private: true` is intentional for now)
- claiming OS notifications while the page is closed
- claiming the client render layer is covered by tests