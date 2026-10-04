// Executed only with --smoke-test against an explicitly isolated profile.
(async () => {
  const checks = [];
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const until = async (test, message) => {
    const deadline = Date.now() + 15000;
    while (!test()) {
      if (Date.now() > deadline) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  try {
    assert(document.getElementById('root'), 'React root exists');
    assert(typeof Worker === 'function', 'Web Workers available');
    assert(typeof WebAssembly === 'object', 'WebAssembly available');
    assert(typeof crypto.randomUUID === 'function', 'secure-context UUID available');
    await until(() => document.querySelector('.auth-form'), 'React sign-in form did not render');
    assert(true, 'React application rendered');
    const workerPath = window.__OPSIS_SMOKE_ASSETS.find(
      (path) => path.includes('/process.worker-') && path.endsWith('.js'),
    );
    assert(workerPath, 'packaged process worker found');
    const calculated = await new Promise((resolve, reject) => {
      const worker = new Worker(workerPath, { type: 'module' });
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error('WASM worker timed out'));
      }, 15000);
      worker.onmessage = ({ data }) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(data);
      };
      worker.onerror = (error) => {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(error.message));
      };
      worker.postMessage({
        id: 1,
        request: {
          version: 3,
          nodes: [
            { id: 'source', process: { op: 'source', text: 'one\ntwo\nthree' } },
            { id: 'head', process: { op: 'head', from: 'source', count: 2 } },
          ],
        },
      });
    });
    assert(
      calculated.ok && calculated.result.nodes[1].output === 'one\ntwo\n',
      'actual Rust/WASM worker calculation',
    );
    const key = 'opsis:desktop-smoke';
    localStorage.setItem(key, 'ok');
    assert(localStorage.getItem(key) === 'ok', 'recovery storage writable');
    localStorage.removeItem(key);
    const health = await fetch('/v1/health');
    assert(health.ok, 'native API gateway reachable');
    const email = `${crypto.randomUUID()}@example.test`;
    const signup = await fetch('/v1/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Desktop QA',
        email,
        password: 'desktop-test-password',
      }),
    });
    assert(signup.status === 201, 'account creation');
    assert((await fetch('/v1/auth/me')).ok, 'native session retained');
    const created = await fetch('/v1/boards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Desktop QA' }),
    });
    assert(created.status === 201, 'board creation');
    const board = await created.json();
    assert((await fetch(`/v1/boards/${board.id}`)).ok, 'board read');
    const generated = await fetch('/v1/boards/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify({ prompt: 'Explain email delivery', agent: 'demo' }),
    });
    const events = (await generated.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert(
      events.some((event) => event.type === 'result' && event.status === 200),
      'demo generation over NDJSON',
    );
    const fill = (selector, value) => {
      const input = document.querySelector(selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    fill('input[type=email]', email);
    fill('input[type=password]', 'desktop-test-password');
    document.querySelector('.auth-form').requestSubmit();
    await until(
      () => document.querySelector('.home-page'),
      'React login did not reach the home page',
    );
    assert(true, 'React login and navigation');
    const example = [...document.querySelectorAll('button')].find((button) =>
      button.textContent.includes('An email’s journey'),
    );
    assert(example, 'built-in example button found');
    example.click();
    await until(
      () => document.querySelectorAll('.react-flow__node').length >= 4,
      'Canvas nodes did not render',
    );
    assert(true, 'React canvas and diagram layout rendered');
    await until(
      () => document.querySelector('.save-status')?.textContent.includes('Saved'),
      'Canvas did not finish saving',
    );
    const boards = await (await fetch('/v1/boards')).json();
    assert(boards.length >= 2, 'React canvas persisted to native SQLite');
    document.querySelector('.board-groups summary').click();
    fill('.group-controls input[maxlength="80"]', 'Desktop group');
    [...document.querySelectorAll('.group-controls button')]
      .find((button) => button.textContent.trim() === 'Add group')
      .click();
    await until(
      () => document.querySelector('.group-controls fieldset'),
      'Group editor did not render',
    );
    const groupChecks = document.querySelectorAll(
      '.group-controls fieldset input[type="checkbox"]',
    );
    groupChecks[2].click();
    groupChecks[0].click();
    await until(
      () => document.querySelector('.save-status')?.textContent.includes('Saved'),
      'Group did not save',
    );
    // The save label can briefly refer to the preceding edit; poll the durable snapshot too.
    let grouped;
    for (let attempt = 0; attempt < 100; attempt++) {
      grouped = await (await fetch('/v1/boards/' + boards[0].id)).json();
      if (grouped.snapshot.board.groups?.[0]?.collapsed) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert(
      grouped.snapshot.board.groups?.[0]?.collapsed,
      'native WebView group collapsed and persisted',
    );
    assert(grouped.snapshot.board.nodes.length >= 4, 'collapsed group retained original concepts');
    history.pushState({}, '', '/settings');
    window.dispatchEvent(new Event('popstate'));
    await until(() => document.querySelector('.agent-settings'), 'Model settings did not render');
    assert(true, 'native WebView model settings rendered');
    fill('.agent-settings input[maxlength="60"]', 'Desktop smoke profile');
    [...document.querySelectorAll('.agent-settings button')]
      .find((button) => button.textContent.trim() === 'Add profile')
      .click();
    await until(
      () => localStorage.getItem('opsis:model-profiles:v1')?.includes('Desktop smoke profile'),
      'Named profile did not persist',
    );
    assert(true, 'native WebView named profile persisted');
    [...document.querySelectorAll('.settings-sections button')]
      .find((button) => button.textContent.trim() === 'Appearance')
      .click();
    await until(
      () => document.querySelector('.theme-preview'),
      'Appearance settings did not render',
    );
    assert(true, 'appearance controls retained beside model settings');
    await fetch('/v1/auth/logout', { method: 'POST' });
    assert((await fetch('/v1/auth/me')).status === 401, 'session revocation');
    window.go.main.Desktop.ReportSmoke(JSON.stringify({ ok: true, checks }));
  } catch (error) {
    window.go.main.Desktop.ReportSmoke(JSON.stringify({ ok: false, checks, error: String(error) }));
  }
})();
