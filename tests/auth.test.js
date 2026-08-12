// フロント + 実サーバー + Postgres + 偽Ollama を通した、認証と解析のテスト。
const { chromium } = require('playwright');
const APP = 'http://localhost:3000/';
const API = 'http://localhost:8080';

let pass = 0, fail = 0;
const check = (n, ok, x) => ok ? (pass++, console.log('  ok   ' + n))
                               : (fail++, console.log('  FAIL ' + n + (x ? '  → ' + x : '')));

const uniq = Date.now();
const EMAIL = `zav${uniq}@example.com`;
const PASS = 'correcthorse';

// メール送信は未実装で、トークンはサーバーのログに出る。テストはそこから拾う。
function readResetToken() {
  const fs = require('fs');
  for (const path of [process.env.API_LOG, '/tmp/api9.log', '/tmp/api8.log']) {
    if (!path || !fs.existsSync(path)) continue;
    const lines = fs.readFileSync(path, 'utf8').split('\n').filter(l => l.includes('password reset for'));
    if (!lines.length) continue;
    const m = lines[lines.length - 1].match(/token=([a-f0-9]+)/);
    if (m) return m[1];
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}) });
  const page = await browser.newPage({ viewport: {width: 480, height: 900} });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(APP);
  await page.waitForFunction(() => typeof ONLINE !== 'undefined' && ONLINE, {timeout: 5000}).catch(()=>{});
  const txt = () => page.textContent('#main');
  const err = () => page.textContent('#li-error');

  // ---- ログイン画面がメール／パスワードになっている ----
  check('サーバーを検出している', await page.evaluate(() => ONLINE));
  check('メール欄がある', await page.isVisible('#li-email'));
  check('パスワード欄がある', await page.isVisible('#li-pass'));
  check('名前だけで入る欄は無い', !(await page.isVisible('#li-name')));

  // ---- 未登録でログインしようとする ----
  await page.fill('#li-email', EMAIL);
  await page.fill('#li-pass', PASS);
  await page.click('#li-btn'); await page.waitForTimeout(400);
  check('未登録では入れない', (await err()).includes('違います'), await err());
  check('ログイン画面のまま', await page.isVisible('#li-email'));

  // ---- 登録する ----
  await page.click('[data-mode="register"]'); await page.waitForTimeout(100);
  await page.fill('#li-name', 'ザビエル');
  await page.fill('#li-email', EMAIL);
  await page.fill('#li-pass', 'short');
  await page.click('#li-btn'); await page.waitForTimeout(200);
  check('短いパスワードは弾く', (await err()).includes('8文字'), await err());

  await page.fill('#li-pass', PASS);
  await page.click('#li-btn'); await page.waitForSelector('.tabbar', {timeout: 5000});
  check('登録してログインできる', await page.isVisible('.tabbar'));
  check('トークンを保持している', await page.evaluate(() => !!AUTH.token));
  check('表示名がサーバー由来', await page.evaluate(() => DB.user.name) === 'ザビエル');

  // ---- リロードしてもログインが続く ----
  await page.reload(); await page.waitForTimeout(900);
  check('開き直してもログインが続く', await page.isVisible('.tabbar'));
  check('中身も戻る', await page.evaluate(() => !!DB.user && !!AUTH.token));

  // ---- 解析：実際にサーバーへ送る ----
  await page.click('.tab[data-tab="print"]'); await page.waitForTimeout(150);
  // 1x1 の PNG を選ばせる
  await page.setInputFiles('#fileInput', {
    name: 'print.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'),
  });
  await page.waitForTimeout(300);
  check('プレビューが出る', await page.isVisible('#startAnalysis'));
  await page.click('#startAnalysis'); await page.waitForTimeout(1200);

  // 候補のタイトルは入力欄の値なので textContent には出ない
  const titles = await page.$$eval('[data-cand-title]', els => els.map(e => e.value));
  check('モデルの読み取り結果が出る', titles.includes('数学プリント 応用問題 p.24'), JSON.stringify(titles));
  check('予定の候補も出る', titles.includes('PTA全体保護者会'), JSON.stringify(titles));
  const dates = await page.$$eval('[data-cand-date]', els => els.map(e => e.value));
  check('日付もモデル由来', dates.includes('2026-08-20') && dates.includes('2026-08-25'), JSON.stringify(dates));
  check('固定のモックではなくなっている',
        await page.evaluate(() => typeof mockCandidates === 'undefined'));

  // ジョブがサーバーに残っている
  const token = await page.evaluate(() => AUTH.token);
  const jobs = await (await fetch(API + '/v1/uploads/jobs', {
    headers: {'Authorization': 'Bearer ' + token},
  })).json();
  check('ジョブがサーバーに記録される', jobs.data.length === 1, JSON.stringify(jobs.data));
  check('状態が review_required になる', jobs.data[0]?.status === 'review_required', jobs.data[0]?.status);
  check('要約が入る', !!jobs.data[0]?.resultSummary, jobs.data[0]?.resultSummary);

  // ---- 確定するとカレンダーとタスクに入る ----
  await page.click('#commitBtn'); await page.waitForTimeout(1500);
  const serverTasks = await (await fetch(API + '/v1/tasks', {
    headers: {'Authorization': 'Bearer ' + token},
  })).json();
  check('確定したタスクがサーバーに入る',
        serverTasks.data.some(t => t.title.includes('数学プリント 応用問題')),
        JSON.stringify(serverTasks.data.map(t => t.title)));

  // ---- ログアウトすると端末からも消える ----
  await page.click('.tab[data-tab="settings"]'); await page.waitForTimeout(200);
  await page.click('#logoutBtn'); await page.waitForTimeout(500);
  check('ログアウトでログイン画面に戻る', await page.isVisible('#li-email'));
  await page.reload(); await page.waitForTimeout(800);
  check('開き直してもログインは戻らない', await page.isVisible('#li-email'));

  // ---- 元のパスワードで入り直すと、データは残っている ----
  await page.fill('#li-email', EMAIL);
  await page.fill('#li-pass', PASS);
  await page.click('#li-btn'); await page.waitForSelector('.tabbar', {timeout: 5000});
  check('入り直せる', await page.isVisible('.tabbar'));
  check('サーバーのデータが戻る',
        await page.evaluate(() => DB.tasks.some(t => t.title.includes('数学プリント 応用問題'))));

  // ---- 読み取ったプリントが残り、見返せる ----
  await page.click('.tab[data-tab="print"]'); await page.waitForTimeout(600);
  const thumbs = await page.$$('[data-print]');
  check('読み取ったプリントが並ぶ', thumbs.length >= 1, `${thumbs.length}枚`);
  if (thumbs.length) {
    // 画像そのものが返っているか（壊れた img は naturalWidth が 0 になる）
    const loaded = await page.$$eval('.print-thumb img', imgs =>
      imgs.every(i => i.complete && i.naturalWidth > 0));
    check('画像が実際に表示される', loaded);
    await thumbs[0].click(); await page.waitForTimeout(400);
    check('タップで拡大して見られる', await page.isVisible('.sheet .preview-img'));
    await page.keyboard.press('Escape');
    await page.evaluate(() => { sess.modal = null; render(); });
  }

  // ---- パスワードの再設定 ----
  await page.click('.tab[data-tab="settings"]'); await page.waitForTimeout(200);
  await page.click('#logoutBtn'); await page.waitForTimeout(500);
  await page.click('#li-forgot'); await page.waitForTimeout(200);
  check('再設定の画面が開く', await page.isVisible('#li-send'));

  await page.fill('#li-email', 'nobody-here@example.com');
  await page.click('#li-send'); await page.waitForTimeout(300);
  check('未登録でも同じ文面（アカウントの有無を漏らさない）',
        (await page.textContent('#li-error')).includes('登録があれば'),
        await page.textContent('#li-error'));

  // 実際のトークンはサーバーのログに出る。テストではAPIを直接叩いて受け取る。
  await page.evaluate(() => { sess.loginMode = 'forgot'; render(); });
  await page.waitForTimeout(200);
  await page.fill('#li-email', EMAIL);
  await page.click('#li-send'); await page.waitForTimeout(1200);
  check('コード入力の画面に進む', await page.isVisible('#li-token'));

  const resetToken = readResetToken();
  check("再設定コードが発行される", !!resetToken, resetToken || "(ログから拾えず)");
  if (resetToken) {
    await page.fill('#li-token', resetToken);
    await page.fill('#li-pass', 'short');
    await page.click('#li-reset'); await page.waitForTimeout(200);
    check('短いパスワードは弾く', (await page.textContent('#li-error')).includes('8文字'));

    await page.fill('#li-pass', 'brandnewpassword');
    await page.click('#li-reset'); await page.waitForTimeout(600);
    check('ログイン画面に戻る', await page.isVisible('#li-email'));

    await page.fill('#li-email', EMAIL);
    await page.fill('#li-pass', PASS);
    await page.click('#li-btn'); await page.waitForTimeout(600);
    check('古いパスワードでは入れない', await page.isVisible('#li-email'));

    await page.fill('#li-email', EMAIL);
    await page.fill('#li-pass', 'brandnewpassword');
    await page.click('#li-btn'); await page.waitForSelector('.tabbar', {timeout: 5000});
    check('新しいパスワードで入れる', await page.isVisible('.tabbar'));
  }

  check('JS エラーが出ていない', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n${pass} 件成功 / ${fail} 件失敗`);
  process.exit(fail ? 1 : 0);
})();
