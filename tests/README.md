# テスト

`index.html` を実際のブラウザ（Chromium）で動かして確かめる。ユニットテストは
無い — このアプリはブラウザの中でしか存在しないので、DOM を外して確かめられる
ものがほとんど無いため。

```bash
npm install
npm test              # サーバー不要のぶんだけ
npm run test:server   # バックエンドを立ててから
```

| ファイル | 何を確かめるか | 必要なもの |
|---|---|---|
| `offline.test.js` | サーバー無しで全機能が動くこと。既存機能の非退行 | なし |
| `server.test.js` | 予定・タスク・時間割・コロニーがサーバーに届き、開き直しても戻ること | API |
| `auth.test.js` | 登録・ログイン・再開・ログアウト、プリントの読み取り | API + 偽Ollama |

## サーバーありのテストを動かす

3つ立てる。`tests/helpers` に補助がある。

```bash
# 1. API（別リポジトリ）
DATABASE_URL=postgres://... go run .

# 2. 偽の Ollama。決まった候補を返すので、モデルを用意せず経路を確かめられる
node tests/helpers/fake-ollama.js

# 3. フロントを API と同じオリジンに載せる
node tests/helpers/serve.js
```

`CHROMIUM_PATH` を立てると、その実行ファイルを使う（Playwright が落としたもの
以外を使いたいとき）。

## 注意

候補の題名は `<input value>` に入るので `textContent` には出ない。
`$$eval('[data-cand-title]', els => els.map(e => e.value))` で読むこと。
