// フロント + 実際の Go サーバーを同一オリジンで動かした通しテスト。
const { chromium } = require('playwright');
const APP = 'http://localhost:3000/';
const API = 'http://localhost:8080';

let pass = 0, fail = 0;
const check = (n, ok, x) => ok ? (pass++, console.log('  ok   ' + n))
                               : (fail++, console.log('  FAIL ' + n + (x ? '  → ' + x : '')));

// X-User-ID は塞がれているので、テストも本物のトークンで叩く。
const uniq = Date.now();
const EMAIL = `zav${uniq}@example.com`;
const OTHER = `other${uniq}@example.com`;
const PASS = 'correcthorse';
const tokens = {};

// ブラウザ側が先に同じアドレスで登録していることがあるので、409 ならログインに回る。
async function tokenFor(email) {
  if (tokens[email]) return tokens[email];
  const body = JSON.stringify({email, password: PASS, displayName: email.split('@')[0]});
  const headers = {'Content-Type': 'application/json'};
  let res = await fetch(API + '/v1/auth/register', {method: 'POST', headers, body});
  if (res.status === 409) {
    res = await fetch(API + '/v1/auth/login', {method: 'POST', headers, body});
  }
  const out = await res.json();
  if (!out.data) throw new Error(`could not get a token for ${email}: ${JSON.stringify(out)}`);
  tokens[email] = out.data.token;
  return tokens[email];
}

const curl = async (path, opts = {}) => {
  const token = await tokenFor(opts.user || EMAIL);
  const res = await fetch(API + path, {
    headers: {
      'Authorization': 'Bearer ' + token,
      ...(opts.body ? {'Content-Type':'application/json'} : {}),
    },
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.status === 204 ? null : (await res.json()).data;
};

(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}) });
  const page = await browser.newPage({ viewport: {width: 480, height: 900} });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(APP);
  const txt = () => page.textContent('#main');

  // ---- 登録してログイン ----
  await page.waitForFunction(() => typeof ONLINE !== 'undefined' && ONLINE, {timeout: 5000});
  await page.click('[data-mode="register"]');
  await page.fill('#li-name', 'ザビエル');
  await page.fill('#li-email', EMAIL);
  await page.fill('#li-pass', PASS);
  await page.click('#li-btn');
  await page.waitForSelector('.tabbar', {timeout: 5000});
  check('サーバーを検出してオンラインになる', await page.evaluate(() => ONLINE));
  check('セッショントークンを保持している', await page.evaluate(() => !!AUTH.token));

  // ---- 予定：フロントで作る → サーバーに入る ----
  await page.click('#addEventFab'); await page.waitForTimeout(80);
  await page.fill('#m-title', '生徒会ミーティング');
  await page.fill('#m-desc', '第2会議室');
  await page.click('#m-save'); await page.waitForTimeout(300);
  let events = await curl('/v1/events');
  check('予定がサーバーに保存される', events.some(e => e.title === '生徒会ミーティング'),
        JSON.stringify(events.map(e => e.title)));
  const ev = events.find(e => e.title === '生徒会ミーティング');
  check('サーバー採番のIDをフロントが持つ',
        await page.evaluate(id => DB.events.some(e => e.id === id), ev.id));

  // ---- 予定：更新（楽観ロックの version が回る） ----
  await page.click(`.card[data-ev="${ev.id}"]`); await page.waitForTimeout(80);
  await page.fill('#m-title', '生徒会ミーティング（変更）');
  await page.click('#m-save'); await page.waitForTimeout(300);
  events = await curl('/v1/events');
  const ev2 = events.find(e => e.id === ev.id);
  check('更新がサーバーに届く', ev2 && ev2.title === '生徒会ミーティング（変更）');
  check('version が上がる', ev2 && ev2.version === ev.version + 1, `${ev?.version} → ${ev2?.version}`);

  // ---- 予定：終日 ----
  await page.click('#addEventFab'); await page.waitForTimeout(80);
  await page.fill('#m-title', '創立記念日');
  await page.check('#m-allday');
  await page.click('#m-save'); await page.waitForTimeout(300);
  events = await curl('/v1/events');
  check('終日フラグがサーバーに渡る', events.some(e => e.title === '創立記念日' && e.allDay === true));

  // ---- 時間割：作る → サーバーに入る ----
  await page.click('.tab[data-tab="tt"]'); await page.waitForTimeout(100);
  await page.click('[data-edit="2_3"]'); await page.waitForTimeout(80);
  await page.fill('#m-subject', '物理');
  await page.fill('#m-room', '理科室');
  await page.click('#m-save'); await page.waitForTimeout(300);
  let tt = await curl('/v1/timetable-entries');
  check('時間割がサーバーに保存される', tt.some(e => e.subject === '物理' && e.dayOfWeek === 2 && e.period === 3),
        JSON.stringify(tt));

  // ---- 時間割 → カレンダーに授業として出る（#9 がサーバー由来でも効くか） ----
  await page.click('.tab[data-tab="cal"]'); await page.waitForTimeout(100);
  const tuesday = await page.evaluate(() => {
    for (let i = 0; i < 28; i++) { const d = addDays(todayStr(), i); if (parseDate(d).getDay() === 2) return d; }
  });
  await page.evaluate(d => { sess.selectedDate = d; sess.calMonth = parseDate(d); render(); }, tuesday);
  await page.waitForTimeout(120);
  check('サーバー由来の時間割が授業として出る', (await txt()).includes('物理'));

  // ---- 時間割：削除 ----
  await page.click('.tab[data-tab="tt"]'); await page.waitForTimeout(100);
  await page.click('[data-edit="2_3"]'); await page.waitForTimeout(80);
  await page.click('#m-del'); await page.waitForTimeout(300);
  tt = await curl('/v1/timetable-entries');
  check('時間割の削除がサーバーに届く', !tt.some(e => e.subject === '物理'));

  // ---- コロニー：作る → サーバーに入る ----
  await page.click('.tab[data-tab="colony"]'); await page.waitForTimeout(100);
  await page.click('#addColonyFab'); await page.waitForTimeout(80);
  await page.fill('#m-name', '2年A組');
  await page.fill('#m-desc', 'クラス共有');
  await page.click('#m-save'); await page.waitForTimeout(300);
  let cols = await curl('/v1/colonies');
  check('コロニーがサーバーに保存される', cols.some(c => c.name === '2年A組'), JSON.stringify(cols));
  const col = cols.find(c => c.name === '2年A組');
  check('サーバー発行の招待コードを使う',
        await page.evaluate(code => DB.colonies.some(c => c.inviteCode === code), col.inviteCode));

  // ---- 共有：タスクを共有 → shared-items に入る ----
  await page.evaluate(() => { sess.tab='task'; sess.colonyDetail=null; render(); });
  await page.waitForTimeout(80);
  await page.click('#addTaskFab'); await page.waitForTimeout(80);
  await page.fill('#m-title', '看板デザイン案');
  await page.click('#m-save'); await page.waitForTimeout(300);
  const serverTasks = await curl('/v1/tasks');
  check('#21 タスクがサーバーに保存される', serverTasks.some(t => t.title === '看板デザイン案'),
        JSON.stringify(serverTasks.map(t => t.title)));

  await page.evaluate(() => { sess.tab='colony'; render(); });
  await page.waitForTimeout(80);
  await page.click(`.card[data-colony]`); await page.waitForTimeout(100);
  await page.click('#shareTaskToColony'); await page.waitForTimeout(100);
  const picks = await page.$$('[data-pick]');
  check('共有するタスクを選ばせる', picks.length > 0);
  await picks[0].click(); await page.waitForTimeout(300);
  const feed = await curl(`/v1/colonies/${col.id}/feed`);
  check('共有アイテムがサーバーに入る', feed.length === 1, JSON.stringify(feed));
  check('共有元のタスクIDが渡る', feed[0] && feed[0].sourceType === 'TASK' && !!feed[0].sourceId);
  check('#25 共有の見出しがサーバーに残る', feed[0] && feed[0].titleSnapshot === '看板デザイン案',
        JSON.stringify(feed[0]));

  // ---- メンバー ----
  const members = await curl(`/v1/colonies/${col.id}/members`);
  check('作成者がメンバーに入る', members.some(m => m.role === 'OWNER'), JSON.stringify(members));

  // ---- 別ユーザーが招待コードで参加 ----
  await page.evaluate(async ({email, pass}) => {
    const out = await Server.register(email, pass, 'べつの人');
    DB.user = {id: out.user.id, name: out.user.displayName};
    DB.token = out.token;
    sess.colonyDetail = null; sess.tab = 'colony'; render();
  }, {email: OTHER, pass: PASS});
  await page.waitForTimeout(150);
  await page.click('#joinColonyBtn'); await page.waitForTimeout(80);
  await page.fill('#m-code', col.inviteCode);
  await page.click('#m-save'); await page.waitForTimeout(500);
  const members2 = await curl(`/v1/colonies/${col.id}/members`, {user: OTHER});
  check('招待コードでサーバー側に参加できる', members2.length === 2, JSON.stringify(members2));
  check('メンバーに表示名が載る', members2.every(m => !!m.displayName), JSON.stringify(members2));

  // ---- リロードしてもサーバーから復元される ----
  // 元のアカウントに戻る
  await page.evaluate(async ({email, pass}) => {
    const out = await Server.signIn(email, pass);
    DB.user = {id: out.user.id, name: out.user.displayName};
    DB.token = out.token;
    await Promise.all(['user','token'].map(save));
  }, {email: EMAIL, pass: PASS});
  await page.reload(); await page.waitForTimeout(700);
  const restored = await page.evaluate(() => ({
    online: ONLINE,
    events: DB.events.map(e => e.title),
    colonies: DB.colonies.map(c => c.name),
    tasks: DB.tasks.map(t => t.title),
  }));
  check('リロード後もオンライン', restored.online);
  check('リロード後に予定がサーバーから戻る',
        restored.events.includes('生徒会ミーティング（変更）'), JSON.stringify(restored.events));
  check('リロード後にコロニーが戻る', restored.colonies.includes('2年A組'), JSON.stringify(restored.colonies));
  check('#21 リロード後にタスクもサーバーから戻る',
        restored.tasks.includes('看板デザイン案'), JSON.stringify(restored.tasks));

  // ---- 予定の削除 ----
  await page.evaluate(() => { sess.tab='cal'; sess.calView='month'; render(); });
  await page.waitForTimeout(100);
  const before = (await curl('/v1/events')).length;
  await page.evaluate(async () => {
    const e = DB.events.find(x => x.title === '創立記念日');
    sess.modal = {kind:'event', data:e, occurrenceDate:null, scope:'one'};
    renderModal();
  });
  await page.waitForTimeout(120);
  await page.click('#m-del'); await page.waitForTimeout(350);
  check('削除がサーバーに届く', (await curl('/v1/events')).length === before - 1);

  // ---- サーバーを止めても操作は止まらない ----
  await page.route('**/v1/**', r => r.abort());
  await page.evaluate(() => { sess.tab='task'; render(); });
  await page.waitForTimeout(100);
  await page.click('#addTaskFab'); await page.waitForTimeout(80);
  await page.fill('#m-title', 'オフラインで足したタスク');
  await page.click('#m-save'); await page.waitForTimeout(200);
  check('サーバーが落ちても端末内では足せる', (await txt()).includes('オフラインで足したタスク'));
  await page.unroute('**/v1/**');

  check('JS エラーが出ていない', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n${pass} 件成功 / ${fail} 件失敗`);
  process.exit(fail ? 1 : 0);
})();
