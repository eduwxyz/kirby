'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', 'hooks', 'block-destructive.js');

// Repo git com um commit na branch `branch`; `dirty` deixa uma mudança não commitada.
function makeRepo({ branch = 'main', dirty = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kirby-'));
  const sh = cmd => execSync(cmd, { cwd: root, stdio: 'ignore' });
  sh('git init -q -b main && git config user.email k@k && git config user.name kirby');
  fs.writeFileSync(path.join(root, 'app.js'), 'v1');
  sh('git add . && git commit -q -m init');
  if (branch !== 'main') sh(`git checkout -q -b ${branch}`);
  if (dirty) fs.writeFileSync(path.join(root, 'app.js'), 'v2');
  return root;
}

function hook(root, command, { tool = 'Bash', env = {} } = {}) {
  const fullEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, ...env };
  if (!('KIRBY_ALLOW_DESTRUCTIVE' in env)) delete fullEnv.KIRBY_ALLOW_DESTRUCTIVE;
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: tool, tool_input: { command }, cwd: root }),
    env: fullEnv,
    encoding: 'utf8',
  });
  return { code: r.status, stderr: r.stderr };
}

const BLOCK = 2;
const ALLOW = 0;

async function table(t, root, cases) {
  for (const [command, expected] of cases) {
    await t.test(`${expected === BLOCK ? 'bloqueia' : 'permite'}: ${command}`, () => {
      assert.equal(hook(root, command).code, expected, command);
    });
  }
}

test('git push', async t => {
  await table(t, makeRepo({ branch: 'feat' }), [
    ['git push', ALLOW],
    ['git push -u origin feat', ALLOW],
    ['git push --force-with-lease origin feat', ALLOW],
    ['git push --force-with-lease', ALLOW],
    ['git push origin --delete feat', ALLOW],
    ['git push -f', BLOCK],
    ['git push --force origin feat', BLOCK],
    ['git push origin +feat', BLOCK],
    ['git -C . push -uf origin feat', BLOCK],
    ['git push --force-with-lease origin main', BLOCK],
    ['git push --force-with-lease origin HEAD:release/2026-09', BLOCK],
    ['git push -d origin main', BLOCK],
    ['git push origin :master', BLOCK],
    ['git push --mirror', BLOCK],
    ['git push --no-verify', BLOCK],
  ]);
});

test('git push sem refspec usa a branch atual', async t => {
  await table(t, makeRepo({ branch: 'main' }), [
    ['git push', ALLOW],
    ['git push --force-with-lease', BLOCK],
  ]);
});

test('descartar trabalho com mudanças não commitadas', async t => {
  await table(t, makeRepo({ dirty: true }), [
    ['git reset --hard', BLOCK],
    ['git reset --hard HEAD~1', BLOCK],
    ['git checkout .', BLOCK],
    ['git checkout -- .', BLOCK],
    ['git checkout -f other', BLOCK],
    ['git restore .', BLOCK],
    ['git switch --discard-changes other', BLOCK],
    ['git reset --soft HEAD~1', ALLOW],
    ['git checkout -- app.js', ALLOW],
    ['git restore --staged .', ALLOW],
    ['git stash', ALLOW],
  ]);
});

test('com a árvore limpa, reset/checkout não perdem nada', async t => {
  await table(t, makeRepo(), [
    ['git reset --hard HEAD~1', ALLOW],
    ['git checkout .', ALLOW],
  ]);
});

test('outros git', async t => {
  await table(t, makeRepo(), [
    ['git clean -fd', BLOCK],
    ['git clean -xdf', BLOCK],
    ['git clean -n', ALLOW],
    ['git clean -fdn', ALLOW],
    ['git stash clear', BLOCK],
    ['git commit --no-verify -m wip', BLOCK],
    ['git commit -nm wip', BLOCK],
    ['git commit -am wip', ALLOW],
    ['git merge --no-verify feat', BLOCK],
    ['git status', ALLOW],
  ]);
});

test('rm', async t => {
  const root = makeRepo();
  fs.mkdirSync(path.join(root, 'build'));
  await table(t, root, [
    ['rm -rf build', ALLOW],
    ['rm -rf build/*', ALLOW],
    ['rm app.js', ALLOW],
    ['rm *.log', ALLOW],
    [`rm -rf ${path.join(os.tmpdir(), 'kirby-lixo')}`, ALLOW],
    ['rm -rf /tmp/kirby-lixo', ALLOW],
    ['cd build && rm -rf ..', BLOCK],
    ['rm -rf /', BLOCK],
    ['rm -rf ~', BLOCK],
    ['rm -rf ~/Documents', BLOCK],
    ['rm -rf $HOME/qualquer', BLOCK],
    ['rm -rf $KIRBY_VAR_QUE_NAO_EXISTE/x', BLOCK],
    ['rm -rf ..', BLOCK],
    ['rm -rf .', BLOCK],
    ['rm -rf *', BLOCK],
    ['rm -rf ./*', BLOCK],
    ['rm -rf .git', BLOCK],
    ['rm -rf /tmp/*', BLOCK],
    ['rm ~/.zshrc', BLOCK],
  ]);
});

test('banco de dados', async t => {
  await table(t, makeRepo(), [
    ['psql -c "DROP TABLE users"', BLOCK],
    ['psql -c "drop database app"', BLOCK],
    ['mysql -e "TRUNCATE orders"', BLOCK],
    ['psql -c "DELETE FROM users"', BLOCK],
    ['sqlite3 app.db "UPDATE users SET admin = 1"', BLOCK],
    ['psql -c "DELETE FROM users WHERE id = 1"', ALLOW],
    ['psql -c "select * from users"', ALLOW],
  ]);
});

test('infra e APIs', async t => {
  await table(t, makeRepo(), [
    ['kubectl -n prod delete pod api-123', BLOCK],
    ['kubectl drain node-1', BLOCK],
    ['kubectl get pods', ALLOW],
    ['helm uninstall api', BLOCK],
    ['terraform destroy', BLOCK],
    ['terraform apply -auto-approve', BLOCK],
    ['terraform state rm aws_instance.x', BLOCK],
    ['terraform plan', ALLOW],
    ['terraform apply', ALLOW],
    ['aws s3 rm s3://bucket/dados --recursive', BLOCK],
    ['aws s3 rb s3://bucket', BLOCK],
    ['aws dynamodb delete-table --table-name x', BLOCK],
    ['aws ec2 terminate-instances --instance-ids i-1', BLOCK],
    ['aws s3 ls', ALLOW],
    ['gcloud run services delete api', BLOCK],
    ['docker system prune -a', BLOCK],
    ['docker volume rm dados', BLOCK],
    ['docker ps', ALLOW],
    ['curl -X DELETE https://api.exemplo.com/users/1', BLOCK],
    ['curl --request=DELETE https://api.exemplo.com/users/1', BLOCK],
    ['curl -XDELETE https://api.exemplo.com/users/1', BLOCK],
    ['curl -X DELETE http://localhost:3000/users/1', ALLOW],
    ['curl https://api.exemplo.com/users', ALLOW],
  ]);
});

test('composição de comandos', async t => {
  await table(t, makeRepo(), [
    ['npm test && git push -f', BLOCK],
    ['bash -c "git push --force"', BLOCK],
    ['echo "git push -f"', ALLOW],
    ['git log --oneline | head -5', ALLOW],
    ['cd /tmp && rm -rf kirby-lixo', ALLOW],
  ]);
});

test('liberação e outras ferramentas', () => {
  const root = makeRepo();
  assert.equal(hook(root, 'git push -f', { env: { KIRBY_ALLOW_DESTRUCTIVE: '1' } }).code, ALLOW);
  assert.equal(hook(root, 'git push -f', { tool: 'Edit' }).code, ALLOW);
});

test('mensagem diz o motivo e a saída', () => {
  const { stderr } = hook(makeRepo(), 'git push -f');
  assert.match(stderr, /force-with-lease/);
  assert.match(stderr, /KIRBY_ALLOW_DESTRUCTIVE/);
});
