# 他力本願カレンダー — フロントエンド

プリントを撮ると、AI が予定とタスクに仕分けてくれる学生向けカレンダー。
`index.html` 一枚で動く。ビルド工程は無い。

## 動かす

### 端末内だけで動かす

`index.html` をブラウザで開くだけ。データは `localStorage` に入る。

### バックエンドと繋いで動かす

バックエンドは [gcs-coding-team/tarikihonganncalendar](https://github.com/gcs-coding-team/tarikihonganncalendar)。

```bash
# 1. API を起動（別リポジトリ側で）
DATABASE_URL=postgres://... go run .    # :8080

# 2. フロントを配信
node dev-server.js                       # :3000
```

`DATABASE_URL` を省くと API はメモリ上で動き、再起動で全部消えます。

http://localhost:3000 を開く。設定タブに「接続中」と出れば繋がっている。

`dev-server.js` は `/v1` と `/healthz` を API に中継して、フロントと API を
同じオリジンに見せる。この形なら CORS は関わらない。

### 別オリジンに置く場合

API 側で許可するオリジンを指定し、フロント側で API の場所を教える。片方だけでは
ブラウザが弾く。

```bash
FRONTEND_ORIGIN=http://localhost:3100 go run .    # API 側
```

```html
<script>window.TARIKI_API_ORIGIN = 'http://localhost:8080';</script>
```

## サーバーと端末の分担

| データ | 置き場 |
|---|---|
| 予定（繰り返しを含む） | サーバー `/v1/events` |
| タスク | サーバー `/v1/tasks` |
| プロジェクト | サーバー `/v1/projects` |
| 時間割 | サーバー `/v1/timetable-entries` |
| コロニー・共有 | サーバー `/v1/colonies` |
| アカウント | サーバー `/v1/auth` |
| ログイントークン | 端末（`localStorage`） |

サーバーに繋がらないときは、名前だけで始める「おためし」になり、全部が端末内で動く。
書き込みに失敗しても操作は止めず、端末内の変更だけ残してその旨を知らせる。

## プリントの読み取り

撮った画像はそのままサーバーへ送られ、`OLLAMA_MODEL` が読む。返ってきた候補は
確認画面に出るだけで、そのままカレンダーには入らない。読めなかった行は捨てる
（推測で日付を埋めない）。モデルに繋がらないときは、その旨を出して終わる。

画像はサーバーに残るので、プリントタブから見返せる。画像の口はトークンを要り、
`<img src>` はヘッダーを送れないので、取得してから object URL に差し替えている。

## テスト

`tests/` にある。詳しくは [tests/README.md](tests/README.md)。

```bash
npm install
npm test              # サーバー不要（39項目）
npm run test:server   # API を立ててから（27 + 37項目）
```

## 表示するときに組み立てているもの

保存はせず、表示のたびに `eventsForDate()` が組み立てる。

- **授業** — 時間割から導く。読み取り専用で、直すのは時間割タブ。
  各限の開始時刻は `PERIOD_START` にある。
- **繰り返しの各回** — 規則と除外日はサーバーが持ち、展開はフロントがやる。

こうすると、時間割を1つ直せば過去も未来も一斉に追従する。

## 本番環境（U-22 プログラミング・コンテスト2026）

さくらのクラウド上に、フロント・API・DB・AI（Ollama）を1台にまとめて動かしている。
デプロイの詳細はバックエンド側の
[docs/deploy.md](https://github.com/gcs-coding-team/tarikihonganncalendar/blob/main/docs/deploy.md)
を参照。

**URL**：http://163.43.230.242/

### デモアカウント

審査・確認用に、実データを含まないアカウントを用意している。

| 用途 | メールアドレス | パスワード |
|---|---|---|
| 審査員用 | `judge@tariki-calendar.jp` | `TarikiDemo2026` |
| 班員用（動作確認） | `team@tariki-calendar.jp` | `TarikiTeam2026` |

どちらも、時間割・タスク・予定（単発／繰り返し／終日）・プロジェクト・コロニーが
最初から一通り入っている。プリントの読み取り（AI取込）だけは、実際に画像を
アップロードして試す機能なので、あらかじめ仕込むことができない — ログイン後に
「プリント」タブから試せる。

アプリ内の使い方は、ログイン後「設定」タブの「使い方ガイド」からも確認できる。
