const { chromium } = require('playwright');

const FILE = 'file://' + require('path').resolve(__dirname, '../index.html');
let pass = 0, fail = 0;
function check(name, ok, extra){
  if(ok){ pass++; console.log('  ok   ' + name); }
  else  { fail++; console.log('  FAIL ' + name + (extra? '  → '+extra : '')); }
}

(async () => {
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH} : {}) });
  const page = await browser.newPage({ viewport: {width: 480, height: 900} });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(FILE);

  // ---- login ----
  await page.fill('#li-name', 'ザビエル');
  await page.click('#li-btn');
  await page.waitForSelector('.tabbar');
  check('ログインしてカレンダーが出る', await page.isVisible('.cal-grid'));

  const tab = async (k) => { await page.click(`.tab[data-tab="${k}"]`); await page.waitForTimeout(60); };
  const txt = () => page.textContent('#main');

  // ---- #10 締切サマリ ----
  check('#10 締切パネルが出る', await page.isVisible('.due-panel'));
  check('#10 「今日」の行がある', (await txt()).includes('今日'));

  // ---- #9 時間割がカレンダーに出る ----
  // シードは月/火/水にコマがある。該当曜日を選ぶ。
  // 再描画で要素が差し替わるので、毎回インデックスで引き直す。
  let lessonSeen = false;
  const dayCount = (await page.$$('.cal-day[data-date]')).length;
  for (let i = 0; i < dayCount; i++) {
    await page.click(`.cal-day[data-date] >> nth=${i}`); await page.waitForTimeout(25);
    if (await page.isVisible('.card.lesson')) { lessonSeen = true; break; }
  }
  check('#9 授業がカレンダーに出る', lessonSeen);
  check('#9 授業は手入力の予定と見分けが付く', await page.isVisible('.chip.lesson'));
  check('#9 授業カードは編集用の data-ev を持たない',
        (await page.$$('.card.lesson[data-ev]')).length === 0);

  // ---- #11 週表示 / 日表示 ----
  await page.click('.viewswitch-btn[data-view="week"]'); await page.waitForTimeout(60);
  check('#11 週表示に7日ぶんの見出しが出る', (await page.$$('.week-head')).length === 7);
  await page.click('.viewswitch-btn[data-view="day"]'); await page.waitForTimeout(60);
  check('#11 日表示が時間軸で出る', (await page.$$('.hour-label')).length > 0);
  await page.click('.viewswitch-btn[data-view="month"]'); await page.waitForTimeout(60);

  // ---- #13 繰り返し ----
  // シードの「部活 全体練習」は毎週。翌週の同じ曜日にも出るはず。
  await page.evaluate(() => { sess.selectedDate = addDays(todayStr(), 7); sess.calMonth = parseDate(sess.selectedDate); render(); });
  await page.waitForTimeout(60);
  check('#13 繰り返し予定が翌週にも出る', (await txt()).includes('部活 全体練習'));
  check('#13 繰り返しの印が付く', await page.isVisible('.chip.blue'));

  // この回だけ削除
  await page.click('.card[data-ev][data-occ]'); await page.waitForTimeout(60);
  check('#13 繰り返しの回に「直す範囲」が出る', await page.isVisible('[data-scope]'));
  await page.click('#m-del'); await page.waitForTimeout(80);
  check('#13 この回だけ消える', !(await txt()).includes('部活 全体練習'));
  await page.evaluate(() => { sess.selectedDate = addDays(todayStr(), 14); render(); });
  await page.waitForTimeout(60);
  check('#13 他の回は残る', (await txt()).includes('部活 全体練習'));

  // ---- #6 終日 ----
  await page.evaluate(() => { sess.selectedDate = todayStr(); sess.calMonth = parseDate(sess.selectedDate); render(); });
  await page.click('#addEventFab'); await page.waitForTimeout(60);
  await page.fill('#m-title', '終日テスト');
  await page.check('#m-allday'); await page.waitForTimeout(40);
  check('#6 終日にすると時刻欄が消える', !(await page.isVisible('#m-time-field')));
  await page.click('#m-save'); await page.waitForTimeout(80);
  check('#6 終日として表示される', (await txt()).includes('終日'));

  // ---- #5 タスク編集 ----
  await tab('task');
  const before = await txt();
  check('#5 タスクが並ぶ', before.includes('数学プリント'));
  await page.click('.card[data-task]'); await page.waitForTimeout(60);
  check('#5 タップで編集モーダルが開く', (await page.textContent('.sheet')).includes('タスクを編集'));
  await page.fill('#m-title', '数学プリント（直した）');
  await page.click('#m-save'); await page.waitForTimeout(80);
  const after = await txt();
  check('#5 編集が反映される', after.includes('数学プリント（直した）'));
  check('#5 増えずに置き換わる', !after.includes('数学プリント p.12-13'));
  const countBefore = (await page.$$('.card[data-task]')).length;
  await page.click('.card[data-task] .check'); await page.waitForTimeout(80);
  check('#5 チェックでモーダルが開かない', !(await page.isVisible('.sheet')));
  check('#5 チェックしても件数は変わらない', (await page.$$('.card[data-task]')).length === countBefore);

  // ---- #12 検索 ----
  await page.click('#searchBtn'); await page.waitForTimeout(60);
  await page.fill('#searchInput', '数学'); await page.waitForTimeout(80);
  check('#12 タスクが引ける', (await txt()).includes('数学プリント（直した）'));
  await page.fill('#searchInput', '部活'); await page.waitForTimeout(80);
  check('#12 予定も横断して引ける', (await txt()).includes('部活 全体練習'));
  await page.click('[data-filter="done"]'); await page.waitForTimeout(60);
  check('#12 状態で絞ると予定は外れる', !(await txt()).includes('部活 全体練習'));
  await page.fill('#searchInput', 'ぜったいにない語'); await page.waitForTimeout(80);
  check('#12 見つからないとそう出る', (await txt()).includes('一致するものはありません'));
  await page.click('#searchBtn'); await page.waitForTimeout(60);

  // ---- #7 / #8 コロニー ----
  await tab('colony');
  await page.click('#addColonyFab'); await page.waitForTimeout(60);
  await page.fill('#m-name', '3年A組');
  await page.click('#m-save'); await page.waitForTimeout(80);
  check('#8 人数が実データで出る', (await txt()).includes('1人'));
  await page.click('.card[data-colony]'); await page.waitForTimeout(60);
  check('#8 参加者一覧に自分が出る', (await txt()).includes('ザビエル'));

  await page.click('#shareTaskToColony'); await page.waitForTimeout(60);
  check('#7 共有するタスクを選ばせる', (await page.textContent('.sheet')).includes('共有するタスクを選ぶ'));
  const picks = await page.$$('[data-pick]');
  await picks[picks.length - 1].click(); await page.waitForTimeout(80);
  const feed = await txt();
  check('#7 選んだタスクが共有される', feed.includes('看板デザイン案の提出'));
  check('#7 先頭のタスク固定になっていない', !feed.includes('数学プリント（直した）'));

  // 招待コードで参加（別人になりすまして確認）
  const code = await page.evaluate(() => DB.colonies[0].inviteCode);
  await page.evaluate(() => { DB.user = {id:'other', name:'べつの人'}; sess.colonyDetail = null; render(); });
  await page.click('#joinColonyBtn'); await page.waitForTimeout(60);
  await page.fill('#m-code', 'ZZZZZZ');
  await page.click('#m-save'); await page.waitForTimeout(80);
  check('#8 でたらめなコードは弾く', (await page.textContent('#toast')).includes('見つかりません'));
  await page.fill('#m-code', code.toLowerCase());   // 小文字でも通ること
  await page.click('#m-save'); await page.waitForTimeout(100);
  check('#8 招待コードで参加できる', (await txt()).includes('べつの人'));
  check('#8 人数が2人になる', await page.evaluate(() => DB.colonies[0].members.length === 2));
  await page.click('#leaveColony'); await page.waitForTimeout(80);
  check('#8 抜けると人数が戻る', await page.evaluate(() => DB.colonies[0].members.length === 1));

  // ---- 既存機能が壊れていないか ----
  await tab('proj');
  check('既存: プロジェクトが出る', (await txt()).includes('文化祭 実行委員'));
  await tab('tt');
  check('既存: 時間割が出る', (await txt()).includes('数学'));
  await tab('print');
  check('既存: プリント取込が出る', (await txt()).includes('プリントを撮影'));
  await tab('settings');
  check('既存: 設定が出る', (await txt()).includes('ユーザーID'));

  check('JS エラーが出ていない', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(`\n${pass} 件成功 / ${fail} 件失敗`);
  process.exit(fail ? 1 : 0);
})();
