#!/usr/bin/env node
// Release notes for a tag, built from the commit history since the previous stable release.
//
//   node scripts/release-notes.mjs v1.3.0 [--repo owner/name] [--from v1.2.2] > notes.md
//
// Commit subjects are grouped by conventional-commit type: breaking changes, features (feat),
// fixes (fix) and everything else. The tag does not have to exist yet; the notes then cover
// everything up to HEAD. Needs the tags in the checkout (git fetch --tags).
//
// Plain Node, no dependencies. The functions are exported so they can be imported without
// running the command line part.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const CONVENTIONAL = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/;

const SECTIONS = [
  ['breaking', 'Breaking changes'],
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['other', 'Other changes'],
];

/** `{ group, scope, text }` for one commit, or null for version bump commits. */
export function classify({ subject, body = '' }) {
  const match = CONVENTIONAL.exec(subject);
  const type = match?.[1].toLowerCase();
  const scope = match?.[2] || undefined;
  const text = match ? match[4] : subject;

  // "Release: v1.3.0", "chore(release): v1.3.0" and "chore: bump to 1.3.0" say nothing the release
  // itself does not. Dependency bumps ("chore(deps): bump zod ...") stay in the notes.
  const bump =
    type === 'chore' && (scope === 'release' || /^(bump (to|version)|release)\b/i.test(text));
  if (bump || /^release\b/i.test(subject)) return null;

  const breaking = Boolean(match?.[3]) || /^BREAKING[ -]CHANGE:/m.test(body);
  let group = 'other';
  if (breaking) group = 'breaking';
  else if (type === 'feat' || type === 'fix') group = type;

  return { group, scope, text };
}

function entryLine({ sha, scope, text }, repo) {
  const short = sha.slice(0, 7);
  const ref = repo ? `[${short}](https://github.com/${repo}/commit/${sha})` : short;
  return `- ${scope ? `**${scope}:** ` : ''}${text} (${ref})`;
}

/** Markdown for already parsed commits (`{ sha, subject, body }`, newest first). */
export function renderNotes({ commits, tag, previous, repo }) {
  const groups = new Map(SECTIONS.map(([key]) => [key, []]));
  for (const commit of commits) {
    const entry = classify(commit);
    if (entry) groups.get(entry.group).push(entryLine({ ...commit, ...entry }, repo));
  }

  const lines = [];
  for (const [key, title] of SECTIONS) {
    if (groups.get(key).length > 0) lines.push(`### ${title}`, '', ...groups.get(key), '');
  }
  if (lines.length === 0) {
    lines.push(previous ? `No changes since ${previous}.` : 'No changes recorded.', '');
  }

  const compare = repo && previous ? `https://github.com/${repo}/compare/${previous}...${tag}` : '';
  return [
    "## What's changed",
    '',
    ...lines,
    ...(compare ? [`**Full Changelog**: ${compare}`, ''] : []),
  ].join('\n');
}

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** `refs/tags/<tag>` when that tag exists in this checkout, otherwise undefined. */
function existingTagRef(tag) {
  const ref = `refs/tags/${tag}`;
  return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) ? ref : undefined;
}

/** The newest stable tag (no pre-releases) before the tag, or before HEAD when it is not tagged yet. */
export function previousStableTag(tag) {
  const ref = existingTagRef(tag);
  const from = ref ? `${ref}^` : 'HEAD';
  return git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', '--exclude', '*-*', from]);
}

export function readCommits(tag, previous) {
  const end = existingTagRef(tag) ?? 'HEAD';
  const range = previous ? `${previous}..${end}` : end;
  const raw = git(['log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', range]) ?? '';
  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, body = ''] = record.split('\x1f');
      return { sha, subject, body };
    });
}

function parseCommandLine(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { repo: { type: 'string' }, from: { type: 'string' } },
  });
  if (positionals.length !== 1) {
    throw new Error('usage: release-notes.mjs <tag> [--repo owner/name] [--from <tag>]');
  }
  return {
    tag: positionals[0],
    repo: values.repo ?? process.env.GITHUB_REPOSITORY,
    from: values.from,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { tag, repo, from } = parseCommandLine(process.argv.slice(2));
    const previous = from ?? previousStableTag(tag);
    process.stdout.write(renderNotes({ commits: readCommits(tag, previous), tag, previous, repo }));
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
