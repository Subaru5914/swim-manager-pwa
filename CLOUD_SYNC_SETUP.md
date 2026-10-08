# PC・iPhoneの自動同期の設定

Firebase AuthenticationとRealtime Databaseを使います。GitHub PagesのWebサイトはそのまま利用でき、ゲームにFirebase SDKやビルド環境を追加する必要はありません。

## Firebaseでの設定（一度だけ）

1. [Firebaseコンソール](https://console.firebase.google.com/)でプロジェクトを作成します。Google Analyticsの有効化は不要です。
2. プロジェクトに「Webアプリ」を追加します。表示されるFirebase設定から`apiKey`を控えます。
3. 「構築」→「Authentication」→「始める」→「ログイン方法」で「メール／パスワード」を有効にします。
4. 「構築」→「Realtime Database」でデータベースを作成します。開始時はロックモードを選びます。「Firestore Database」とは別のサービスです。画面上部の`https://…firebasedatabase.app`または`https://…firebaseio.com`のURLを控えます。
5. Realtime Databaseの「ルール」に、このリポジトリの[firebase.database.rules.json](./firebase.database.rules.json)の内容を貼り付け、公開します。ログインした本人のデータだけを読み書きできるルールです。
6. [cloud-config.json](./cloud-config.json)の`apiKey`と`databaseURL`に控えた値を入力してGitHubへ反映します。これでPCとiPhoneが同じ保存先を使えます。

```json
{
  "apiKey": "Firebase WebアプリのapiKey",
  "databaseURL": "https://プロジェクト名-default-rtdb.asia-southeast1.firebasedatabase.app"
}
```

`apiKey`と`databaseURL`はWebアプリへ公開する設定です。サービスアカウントの秘密鍵・管理者トークン・アカウントのパスワードをこのファイルへ書かないでください。データのアクセス権はDatabaseのルールで制限します。APIキーのAPI制限を設定する場合はIdentity Toolkit APIとToken Service APIを許可します。

ソースを変更せず試す場合は、ゲームの「データ・情報」→「クラウド同期」→「保存先の設定」に同じ2項目を両端末で入力することもできます。端末ごとの設定はそのブラウザに保存されます。

## PCとiPhoneで使う

1. PCでゲームを開き、「データ・情報」→「クラウド同期」でメールアドレスと6文字以上のパスワードを入力して「アカウント作成」を押します。既存アカウントは「ログイン」を押します。
2. 「クラウド：同期済み」になったら、iPhoneでも同じメールアドレスとパスワードでログインします。
3. 初回ログインで端末とクラウドのデータが異なる場合は、iPhone側で「クラウドを使う」を選びます。その後はセーブ時とオンライン復帰時に自動同期します。ゲームを再表示したときと15秒ごとにも更新を確認します。
4. 別の端末に移る前に「クラウド：同期済み」を確認します。レースや練習結果などの画面を表示中は同期を待ち、閉じると次の確認時に同期します。

オフラインの進行は端末に保存します。両端末で別々に進めて変更が重なった場合は「使用するセーブを選択」と表示し、勝手に片方を上書きしません。必要なら「この端末を書出」でバックアップを作ってから、使うデータを選びます。Firebaseが更新の競合を返した場合も、再度データの選択が必要です。

パスワードはゲームのセーブや端末の保存領域へ書き込みません。ログインを維持するトークンはその端末に保存され、「ログアウト」で削除します。Firebaseの保存先にゲームのセーブを送信します。セーブファイルにはログイン情報を含めません。

セーブは対応ブラウザでgzip圧縮して通信量を抑えます。圧縮セーブの読込にはSafari 16.4以降などCompression Streams対応ブラウザを使用してください。Firebaseの利用枠や料金は[公式料金ページ](https://firebase.google.com/pricing)で確認できます。枠を超えて同期できない場合も、端末のセーブとファイル書出を利用できます。
