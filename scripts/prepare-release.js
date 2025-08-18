#!/usr/bin/env node
/**
 * prepare-release.js
 *
 * Inserts a new version section into CHANGELOG.md based on package.json version,
 * moving current Unreleased notes under the new version with today's date.
 * Leaves an empty Unreleased template.
 */
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const version = pkg.version;
const today = new Date().toISOString().split('T')[0];

const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
if(!fs.existsSync(changelogPath)){
  console.error('CHANGELOG.md not found');
  process.exit(1);
}

let content = fs.readFileSync(changelogPath, 'utf8');

// Simple parser: capture lines between ## [Unreleased] and next ## [
const unreleasedRegex = /## \[Unreleased\]([\s\S]*?)(?=\n## \[|$)/i;
const match = content.match(unreleasedRegex);
if(!match){
  console.error('Unreleased section not found');
  process.exit(1);
}

const unreleasedBody = match[1].trim();

// Build new version block
const newVersionBlock = `## [${version}] - ${today}\n${unreleasedBody ? unreleasedBody + '\n' : ''}`;

// Insert new version block after Unreleased header, and reset Unreleased template
const updated = content.replace(unreleasedRegex, `## [Unreleased]\n\n### Planned\n- (aggiungi qui nuove voci)\n\n${newVersionBlock}\n`);

fs.writeFileSync(changelogPath, updated);
console.log(`CHANGELOG updated for version ${version}`);
