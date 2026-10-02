#!/usr/bin/env node
// The one place that knows where a Flow release version lives.
//
// Release X.Y.Z has to read X.Y.Z in all three of these, and be tagged vX.Y.Z:
//   custom_components/flow/manifest.json      HACS and Home Assistant read the integration version here
//   flow_web/config.yaml                      the add-on version the Supervisor shows and builds with
//   flow_web/Dockerfile (ARG BUILD_VERSION)   which release's flow.tar.gz the add-on image downloads
//
//   node scripts/bump-version.mjs 1.3.0           write 1.3.0 into all three files
//   node scripts/bump-version.mjs --check         exit 1 unless the three files agree
//   node scripts/bump-version.mjs --check v1.3.0  ...and agree with the tag v1.3.0
//
// Plain Node, no dependencies. The functions below are exported so they can be imported
// without running the command line part.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Group 2 is the version. Groups 1 and 3 are written back untouched, so each file keeps its
// own quoting and spacing after an edit. Whitespace is matched with [ \t], never \s, so a match
// can not swallow a line break and the edit can not join or drop lines.
export const LOCATIONS = [
  {
    file: 'custom_components/flow/manifest.json',
    pattern: /^([ \t]*"version"[ \t]*:[ \t]*")([^"\n]+)(")/gm,
  },
  { file: 'flow_web/config.yaml', pattern: /^(version:[ \t]*["']?)([^"'\s#]+)(["']?)/gm },
  {
    file: 'flow_web/Dockerfile',
    pattern: /^(ARG BUILD_VERSION=["']?)([^"'\s]+)(["']?)(?=[ \t]*$)/gm,
  },
];

// 1.3.0 or a pre-release like 1.3.0-rc.1. No build metadata: a Docker tag cannot hold a "+".
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

const USAGE = `Usage:
  node scripts/bump-version.mjs <version>       set the release version (1.3.0 or v1.3.0)
  node scripts/bump-version.mjs --check [tag]   fail unless every version file agrees,
                                                and with the tag when one is given (v1.3.0)`;

class UsageError extends Error {}

/** Accepts "1.3.0" or "v1.3.0" and returns "1.3.0". */
export function normalizeVersion(input) {
  const version = input.startsWith('v') ? input.slice(1) : input;
  if (!VERSION.test(version)) {
    throw new UsageError(`"${input}" is not a version like 1.3.0 or 1.3.0-rc.1`);
  }
  return version;
}

/** The version in one file's text. There must be exactly one entry, or the edit is ambiguous. */
export function readVersion({ file, pattern }, text) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${file}: expected exactly one version entry, found ${matches.length}`);
  }
  return matches[0][2];
}

/** One file's text with its version replaced and nothing else touched. */
export function writeVersion(location, text, version) {
  readVersion(location, text);
  const updated = text.replace(
    location.pattern,
    (_match, before, _old, after) => `${before}${version}${after}`
  );
  if (readVersion(location, updated) !== version) {
    throw new Error(`${location.file}: the edit did not produce version ${version}`);
  }
  if (location.file.endsWith('.json')) {
    JSON.parse(updated);
  }
  return updated;
}

/**
 * What is wrong with these `{ file, version }` entries? An empty list means consistent.
 * With a tag the reference is the tag's version, otherwise the first entry's.
 */
export function checkConsistency(entries, tag) {
  const problems = entries
    .filter(({ version }) => !VERSION.test(version))
    .map(({ file, version }) => `${file}: "${version}" is not a valid version`);

  let reference = entries[0].version;
  if (tag !== undefined) {
    if (!tag.startsWith('v') || !VERSION.test(tag.slice(1))) {
      problems.push(`the tag "${tag}" must look like v1.3.0 (a v, then the version)`);
      return problems;
    }
    reference = tag.slice(1);
  }

  for (const { file, version } of entries) {
    if (version === reference) continue;
    problems.push(
      tag === undefined
        ? `${file} says ${version} but ${entries[0].file} says ${reference}`
        : `${file} says ${version} but the tag ${tag} needs ${reference}`
    );
  }
  return problems;
}

export function readEntries(root = ROOT) {
  return LOCATIONS.map((location) => ({
    ...location,
    version: readVersion(location, readFileSync(join(root, location.file), 'utf8')),
  }));
}

/** Writes `version` into every location. Nothing is written unless all edits are valid. */
export function bump(version, root = ROOT) {
  const edits = LOCATIONS.map((location) => {
    const path = join(root, location.file);
    const before = readFileSync(path, 'utf8');
    return {
      file: location.file,
      path,
      from: readVersion(location, before),
      text: writeVersion(location, before, version),
    };
  });
  for (const { path, text } of edits) {
    writeFileSync(path, text);
  }
  return edits.map(({ file, from }) => ({ file, from, to: version }));
}

function table(rows) {
  const width = Math.max(...rows.map(([file]) => file.length));
  return rows.map(([file, value]) => `  ${file.padEnd(width)}  ${value}`).join('\n');
}

function reportProblems(problems) {
  const prefix = process.env.GITHUB_ACTIONS === 'true' ? '::error::' : 'error: ';
  for (const problem of problems) {
    console.error(`${prefix}${problem}`);
  }
}

/** Runs the command line with `args` and returns the exit code. */
export function run(args, root = ROOT) {
  const [first, second, ...rest] = args;
  try {
    if (first === undefined || first === '-h' || first === '--help') {
      console.log(USAGE);
      return first === undefined ? 2 : 0;
    }

    if (first === '--check') {
      if (rest.length > 0) throw new UsageError(`unexpected argument "${rest[0]}"`);
      const entries = readEntries(root);
      console.log(table(entries.map(({ file, version }) => [file, version])));
      const problems = checkConsistency(entries, second);
      if (problems.length > 0) {
        reportProblems(problems);
        return 1;
      }
      console.log(`OK: ${entries[0].version}${second ? ` matches the tag ${second}` : ''}`);
      return 0;
    }

    if (first.startsWith('-')) throw new UsageError(`unknown option "${first}"`);
    if (second !== undefined) throw new UsageError(`unexpected argument "${second}"`);

    const version = normalizeVersion(first);
    const changes = bump(version, root);
    console.log(
      table(changes.map(({ file, from, to }) => [file, from === to ? to : `${from} -> ${to}`]))
    );
    console.log(`\nNext: commit these files, tag the commit v${version} and push the tag.`);
    console.log('The Release workflow builds, tests and publishes it from there.');
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reportProblems([message]);
    if (error instanceof UsageError) console.error(`\n${USAGE}`);
    return error instanceof UsageError ? 2 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
