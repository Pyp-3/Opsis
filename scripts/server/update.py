#!/usr/bin/env python3
"""Root-installed updater; repository updates cannot replace this deployed script.

Only GitHub's completed main/push CI for the exact fetched SHA is eligible.
Dependency and workflow changes require a new, explicitly reviewed baseline.
No shell commands or deployment hooks are loaded from the fetched repository.
"""
import datetime
import fcntl
import hashlib
import json
import logging
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

ROOT = Path('/opt/opsis')
REPOSITORY = 'Pyp-3/Opsis'
API = f'https://api.github.com/repos/{REPOSITORY}'
LOG = logging.getLogger('opsis-update')


def command(*args, capture=False, **kwargs):
    result = subprocess.run(args, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None, **kwargs)
    return result.stdout.strip() if capture else None


def github(path):
    request = urllib.request.Request(API + path, headers={
        'Accept': 'application/vnd.github+json', 'User-Agent': 'Opsis-VPS-updater',
        'X-GitHub-Api-Version': '2022-11-28',
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def eligible_run(runs, sha):
    matching = [r for r in runs if r.get('head_sha') == sha
                and r.get('head_branch') == 'main' and r.get('event') == 'push'
                and r.get('path') == '.github/workflows/ci.yml'
                and r.get('head_repository', {}).get('full_name') == REPOSITORY]
    if not matching:
        return None
    latest = max(matching, key=lambda r: (r['id'], r.get('run_attempt', 1)))
    return latest if latest.get('status') == 'completed' and latest.get('conclusion') == 'success' else None


def protected_path(path):
    name = PurePosixPath(path).name
    return (name in {'package.json', 'Cargo.lock', 'Cargo.toml', '.npmrc', '.pnpmfile.cjs'}
            or name.startswith(('pnpm-', 'rust-toolchain'))
            or path.startswith(('.github/', 'scripts/server/')))


def git(*args):
    return command('git', '-C', str(ROOT / 'source'), *args, capture=True)


def read_state():
    path = ROOT / 'state.json'
    return json.loads(path.read_text()) if path.exists() else {}


def write_state(state):
    pending = ROOT / 'state.json.pending'
    pending.write_text(json.dumps(state, indent=2) + '\n')
    pending.replace(ROOT / 'state.json')


def download_bundle(run, sha, destination):
    # A successful rerun of only failed jobs can publish the original check job's bundle.
    base = git('show', f'{sha}:VERSION').strip()
    release = select_release(github('/releases?per_page=30'), base, run, sha)
    if release is None:
        raise RuntimeError('No published release matches this successful CI run')
    version = release['tag_name'].removeprefix('v')
    asset = next(a for a in release['assets'] if a['name'] == f'opsis-{version}.zip')
    digest = asset.get('digest', '')
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', digest):
        raise RuntimeError('GitHub did not supply an archive SHA-256 digest; refusing deployment')
    url = asset['browser_download_url']
    if not url.startswith(f'https://github.com/{REPOSITORY}/releases/download/'):
        raise RuntimeError('Unexpected release download host/path')
    archive = destination / 'release.zip'
    with urllib.request.urlopen(url, timeout=120) as response, archive.open('wb') as output:
        shutil.copyfileobj(response, output)
    with archive.open('rb') as source:
        actual = hashlib.file_digest(source, 'sha256').hexdigest()
    if actual != digest.removeprefix('sha256:'):
        raise RuntimeError('Release archive digest mismatch')
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or '..' in path.parts or path.parts[0] != f'opsis-{version}':
                raise RuntimeError('Unsafe release archive path')
            if (entry.external_attr >> 16) & 0o170000 == 0o120000:
                raise RuntimeError('Symlink in release archive')
        bundle.extractall(destination)
    context = destination / f'opsis-{version}'
    metadata = json.loads((context / 'release.json').read_text())
    if metadata['commit'] != sha or metadata['workspaceDirty'] or metadata['branch'] != 'main':
        raise RuntimeError('Release metadata does not match the approved main commit')
    # Build from the exact Git source, using only the prebuilt outputs from CI.
    files = git('ls-tree', '-r', '--name-only', sha).splitlines()
    for path in files:
        candidate = context / path
        if candidate.is_file():
            actual = command('git', 'hash-object', str(candidate), capture=True)
            expected = git('rev-parse', f'{sha}:{path}')
            if actual != expected:
                raise RuntimeError(f'Release source differs from Git: {path}')
    return context


def select_release(releases, base, run, sha):
    pattern = re.compile(rf'v{re.escape(base)}-build\.{run["run_number"]}\.([1-9][0-9]*)\.g{sha[:12]}')
    candidates = []
    for release in releases:
        match = pattern.fullmatch(release.get('tag_name', ''))
        if match and not release.get('draft') and int(match[1]) <= run['run_attempt']:
            candidates.append((int(match[1]), release))
    return max(candidates, key=lambda pair: pair[0])[1] if candidates else None


def container_exists(name):
    return subprocess.run(['docker', 'inspect', name], stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).returncode == 0


def healthy(name):
    # An internal loopback probe never sends account credentials or provider requests.
    probe = "fetch('http://127.0.0.1:8000/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
    for _ in range(30):
        if subprocess.run(['docker', 'exec', name, 'node', '-e', probe],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
            return True
        time.sleep(2)
    return False


def launch(name, image, data, config):
    # Only the live service receives credentials. Candidate startup needs no provider access.
    credentials = (['--mount', f'type=bind,src={config["agent_home"]},dst=/home/node']
                   if name == 'opsis-server' and config.get('agent_home') else [])
    # The live service reuses an operator-provisioned model cache. Read-only storage
    # prevents silent model replacements; candidates never download or warm speech.
    speech = (['--mount', f'type=bind,src={config["model_dir"]},dst=/models,readonly',
               '--env', 'OPSIS_SPEECH=on', '--env', 'OPSIS_MODEL_DIR=/models']
              if name == 'opsis-server' and config.get('model_dir') else
              ['--env', 'OPSIS_SPEECH=off'])
    command('docker', 'run', '-d', '--name', name, '--restart', 'unless-stopped',
            '--network', config['network'], '--read-only', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--pids-limit', '256',
            '--memory', '2g', '--cpus', '2', '--tmpfs', '/tmp:rw,nosuid,nodev,size=512m',
            '--log-driver', 'json-file', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=5',
            '--mount', f'type=bind,src={data},dst=/data',
            '--env', f"OPSIS_PUBLIC_ORIGIN={config['origin']}",
            '--env', f"OPSIS_TRUSTED_PROXY={config['proxy_address']}",
            '--env', f"OPSIS_GUEST_EMAILS={','.join(config.get('guest_emails', []))}",
            *credentials,
            *speech,
            '--env', 'OPSIS_DB_PATH=/data/opsis.sqlite', image)


def deploy(config, state, sha, context):
    dependency_id = command('docker', 'image', 'inspect', config['dependencies_image'],
                            '--format', '{{.Id}}', capture=True)
    if dependency_id != config['dependencies_id']:
        raise RuntimeError('Frozen dependency image changed')
    image = f'opsis-server:{sha}'
    command('docker', 'build', '--pull=false', '--network=none',
            '--build-arg', f"DEPENDENCIES_IMAGE={config['dependencies_image']}",
            '-f', str(ROOT / 'deploy' / 'Dockerfile.release'), '-t', image, str(context))
    with tempfile.TemporaryDirectory(prefix='opsis-smoke-', dir=ROOT) as temporary:
        os.chown(temporary, 1000, 1000)
        try:
            launch('opsis-smoke', image, temporary, config)
            if not healthy('opsis-smoke'):
                raise RuntimeError('Candidate failed empty-database startup; live service unchanged')
        finally:
            if container_exists('opsis-smoke'):
                command('docker', 'logs', '--tail', '60', 'opsis-smoke')
                command('docker', 'rm', '-f', 'opsis-smoke')
    data = ROOT / 'data'
    data.mkdir(exist_ok=True, mode=0o700)
    os.chown(data, 1000, 1000)
    previous = None
    if container_exists('opsis-server'):
        previous = f"opsis-previous-{datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
        command('docker', 'stop', '--time', '45', 'opsis-server')
    # Take the snapshot with the writer stopped. Keep it even on successful deployment.
    try:
        if (data / 'opsis.sqlite').exists():
            backups = ROOT / 'backups'
            backups.mkdir(exist_ok=True, mode=0o700)
            backup = backups / f'{sha}-{time.time_ns()}.sqlite'
            with sqlite3.connect(data / 'opsis.sqlite') as source, sqlite3.connect(backup) as target:
                source.backup(target)
            LOG.info('Pre-deployment database backup: %s', backup)
    except Exception:
        # No migration has run yet, so restarting the previous writer is safe.
        if previous:
            command('docker', 'start', 'opsis-server')
        raise
    if previous:
        command('docker', 'rename', 'opsis-server', previous)
        command('docker', 'update', '--restart=no', previous)
    launch('opsis-server', image, data, config)
    if not healthy('opsis-server'):
        command('docker', 'logs', '--tail', '100', 'opsis-server')
        command('docker', 'stop', 'opsis-server')
        command('docker', 'update', '--restart=no', 'opsis-server')
        raise RuntimeError('New service failed startup. Previous container and database backup retained; manual recovery required')
    state.update(deployed=sha, previous_container=previous)
    state.pop('failed', None)
    write_state(state)
    LOG.info('Deployed %s; previous container: %s', sha, previous)


def main():
    os.umask(0o077)
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    with (ROOT / 'update.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            LOG.info('Another deployment is running')
            return
        config = json.loads((ROOT / 'config.json').read_text())
        state = read_state()
        if git('status', '--porcelain'):
            raise RuntimeError('Deployment source has local changes; refusing to overwrite them')
        git('fetch', '--no-tags', 'origin', 'main')
        sha = git('rev-parse', 'FETCH_HEAD')
        if not re.fullmatch('[a-f0-9]{40}', sha):
            raise RuntimeError('Invalid fetched commit')
        if sha == state.get('deployed'):
            LOG.info('No change: %s', sha)
            return
        if sha == state.get('failed'):
            LOG.error('Commit %s previously failed; inspect logs and clear state.failed to retry', sha)
            return
        run = eligible_run(github(f'/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha={sha}&per_page=20')['workflow_runs'], sha)
        if not run:
            LOG.info('Waiting: no successful latest main/push CI for %s', sha)
            return
        changes = git('diff', '--name-only', config['baseline'], sha).splitlines()
        blocked = [p for p in changes if protected_path(p)]
        if blocked:
            LOG.warning('Review required; frozen dependency/workflow/deployment inputs changed: %s', ', '.join(blocked))
            return
        git('merge-base', '--is-ancestor', config['baseline'], sha)
        LOG.info('CI run %s approved exact commit %s', run['id'], sha)
        try:
            with tempfile.TemporaryDirectory(prefix='opsis-release-', dir=ROOT) as temporary:
                context = download_bundle(run, sha, Path(temporary))
                # Fast-forward to the checked SHA, never a second pull of a moving branch.
                git('merge', '--ff-only', sha)
                deploy(config, state, sha, context)
        except Exception:
            state['failed'] = sha
            write_state(state)
            raise


if __name__ == '__main__':
    try:
        main()
    except Exception:
        LOG.exception('Update failed; inspect retained containers/backups before recovery')
        sys.exit(1)
