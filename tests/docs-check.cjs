// Check public documentation without scanning or modifying local account data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = ['README.md', 'README.en.md', 'docs/usage.zh-CN.md', 'docs/usage.en.md'];
const commandSets = [], commands = [];
let localLinks = 0;
for (const relative of files) {
  const file = path.join(root, relative);
  const markdown = fs.readFileSync(file, 'utf8');
  const prose = markdown.replace(/```[^\n]*\n[\s\S]*?\n```/g, '');
  assert.equal(prose.match(/^# /gm)?.length, 1, relative + ': exactly one document title');
  assert.equal((markdown.match(/^```/gm)?.length || 0) % 2, 0, relative + ': balanced code fences');
  assert(!markdown.includes('/Users/'), relative + ': no personal absolute paths');
  for (const match of prose.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const local = path.resolve(path.dirname(file), decodeURIComponent(target.split('#')[0]));
    assert(local.startsWith(root + path.sep), relative + ': link stays in the repository');
    assert(fs.existsSync(local), relative + ': missing link ' + target);
    assert(fs.statSync(local).size > 0, relative + ': empty target ' + target);
    localLinks++;
  }
  const blocks = [...markdown.matchAll(/```bash\n([\s\S]*?)\n```/g)].map(match => match[1]);
  const cli = blocks.flatMap(block => block.split('\n')).filter(line => /^python3 codex_usage\.py(?: |$)/.test(line));
  commandSets.push(cli);
  commands.push(...cli.map(line => ({file: relative, line, args: line.split(/\s+/).slice(2)})));
}
assert.deepEqual(commandSets[0], commandSets[1], 'README command examples match across languages');
assert.deepEqual(commandSets[2], commandSets[3], 'Guide command examples match across languages');
const parserCheck = [
  'import contextlib, io, json, sys',
  'from codex_usage import build_parser',
  'for example in json.loads(sys.argv[1]):',
  '    with contextlib.redirect_stdout(io.StringIO()):',
  '        try:',
  '            build_parser().parse_args(example["args"])',
  '        except SystemExit as exc:',
  '            if exc.code != 0:',
  '                raise RuntimeError(example["file"] + ": " + example["line"]) from exc',
].join('\n');
execFileSync(process.env.PYTHON || 'python3', ['-c', parserCheck, JSON.stringify(commands)], {
  cwd: root, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'},
});
console.log(JSON.stringify({documents: files.length, localLinks, cliExamples: commands.length, bilingualCommandsMatch: true}, null, 2));
