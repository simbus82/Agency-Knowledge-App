# Changelog

All notable changes to this project are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) • Adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
### Removed
- Legacy engines (`ai-executive-engine`, `business-intelligence`, `semantic-content-engine`) physically deleted (consolidated into unified AI First engine)
- Legacy shims under `src/legacy` deleted
- Root duplicate scripts (`test-connections.js`, `test-ai-engine.js`, `debug-startup.js`) replaced by consolidated `tools/` versions
- Transitional root `ai-first-engine.js` still present as shim (scheduled for removal before 1.0)
### Changed
- Test & debug scripts physically relocated to `tools/` and originals removed
- Updated README to reflect completed migration & cleanup
### Planned
- Slack integration
- Notion support
- Analytics dashboard
- Voice input/output
- Multi-language UI improvements
- Webhooks & outbound triggers
- Custom AI prompt profiles
- Advanced reporting pack
- Plugin / extension system
- Vector store for long-term semantic memory

### Added
- Modular docs in `docs/` directory + index
- CI quality workflow (`ci.yml`) with lint & tests
- ESLint + Prettier configs and scripts
- Security policy, code of conduct, issue/pr templates

### Changed
- Legacy `documentation.md` marked deprecated
- Source layout migration: engine moved to `src/engines/ai-first-engine.js`
- Added `tools/` directory (wrappers for test/debug scripts)

### Fixed
- Shared Drive search issues (allDrives flags)
- Stale token edge cases via refresh logic

### Security
- Encrypted refresh tokens
- Token refresh error logging
- Size & truncation guards for file parsing
- Added baseline security policy doc

### Notes
- Pre-1.0: minor bumps may still adjust internal APIs

[0.9.0]: https://github.com/simbus82/Agency-Knowledge-App/releases/tag/v0.9.0