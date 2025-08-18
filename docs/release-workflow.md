# Release & Versioning

## Versioning
Semantic Versioning: MAJOR.MINOR.PATCH
Current base: 0.9.0
Single source: `package.json`

## Script
```bash
npm run release:prep   # aggiorna CHANGELOG
npm run release:patch  # bump patch + tag
git push origin main --follow-tags
```
Altri: `release:minor`, `release:major`

## CHANGELOG
Formato Keep a Changelog con sezione Unreleased spostata da `prepare-release.js`.

## GitHub Action
Workflow `release.yml` valida changelog e crea draft release su push tag `v*`.

## Flow Consigliato
1. Verifica test / health
2. `npm run release:prep`
3. Commit + push
4. `npm run release:patch|minor|major`
5. Push + verifica action

## Futuro
- Conventional commits → changelog auto
- Deploy auto su tag
- Pre-release channel (`-beta.N`)

