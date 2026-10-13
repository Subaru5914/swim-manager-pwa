# CPUの能力・PB分布の参照記録

## v1.93：能力・PBの整合と大学の選手層

以下の個人種目の公式予選・決勝と、[関西大会の個人・リレー結果](./KANSAI_RECORD_REFERENCES.md)を再照合しました。大学のリレーは総合タイムと4泳者のラップを参照し、個人PBだけから4人の所属を決めた場合の過剰な戦力集中を補正します。CPUに設定した能力から求める時計は自チームと共通です。

- CPUの能力を逆算する係数を、現行の100m・200mのレース係数と一致させます。50m・400mも同じ係数関数から求めます。
- 関西と全国の個人分布を分け、泳法・距離の能力を同時に近似します。4×100m・4×200mフリー、4×100mメドレーは大学単位の選手層を参照します。メドレーは種目ごとの実ラップを使い、弱い泳法の穴埋めのために既に速い自由形をさらに強化しません。
- 学校・社会人も全距離で参照分布より過剰に速い層を補正します。100mBa・Brは大学も含めて確認します。
- IM専門選手のIM専門選手の200m・400mの参照順位を共通の分位で合わせ、無理な組み合わせからスピードだけを上限へ押し上げません。大学CPUの固定適性は±20以内です。
- 初回の対応表を保存し、新しいカテゴリへ進む既存IDにも再使用します。学年が上がるだけでは再適用しません。進学は泳法別に枠を割り当て、有力枠が自由形ばかりになることを防ぎます。新入生の加入でリレーの選手層が過剰になる場合は、加入者の能力・PBだけを同じ公式基準へ調整し、上級生と自チームは維持します。
- 旧CPUの能力・PB・記録表に残った矛盾を一度修正します。同じID・種目の旧記録へPBの修正差分を反映し、リレーの保存ラップが全員分あれば合計も再計算します。自チームと卒業生の記録、終了済み大会の順位と得点は保持します。スカウト済み選手は能力を保ち、範囲外のPBだけを直します。

以下のv1.72の「CPUの保存済みPB・記録をすべて保持する」という説明は当時の移行仕様です。v1.93では今回依頼された旧CPUの修正を適用します。

## 個人種目の公式参照資料

男子・長水路。2026年のSEIKO公式結果から予選・決勝78ファイルを参照しました。各選手の予選と決勝の速い方を一度だけ集計し、上位だけでなく予選全体の広がりを数値サンプルとしてHTMLへ同梱しています。これは大会内の最速記録であり、実在選手の生涯PB一覧ではありません。架空選手の名前・学校・戦績はゲーム内で生成します。

CPUのタイムだけを散らさず、同じ泳法の50m・100m・200m・400mを同時に近似するよう、スピード・スタミナ・ターンを調整します。IM専門選手は公式IMの分布も参照し、4泳法の平均と固定適性から算出するIM能力で合わせます。能力からレースのタイムを出す式は自チームと共通です。

カテゴリ・種目ごとに実際の順位間隔を参照し、保存した乱数シードの大会レベル・間隔補正を加えます。毎年同じ順位・人数・タイムには固定しません。元の生成能力から参照分布へ対応させる変換は初回に保存し、選手ごと・カテゴリごとに一度だけ適用します。既存選手の毎年の再順位付けや能力への重複加算は行いません。

中学生は高校生の分布より9％遅いゲーム内基準です。高校・大学に存在しない50mBa・Br・Flyは、日本選手権の50m分布を、各カテゴリの100mと日本選手権100mの同順位比率で調整した推定値です。社会人の参照にした日本選手権には学生も出場するため、国内トップ層の基準として使用しています。公式大会よりCPU人数が多い場合、参照人数の先は元の弱い選手の広がりまで補間して裾を延ばします。

この調整は生成されたCPUの基本能力・初期PBを対象とします。自チーム、卒業生、スカウト済み選手の基本能力・PBと、保存済みの10傑・大会の記録は保持します。旧セーブのCPUについては保存済みの記録表・肩書・戦績に残っている最速記録を保持し、初回調整後のCPUのPBは生成PBも含めて次のカテゴリへ持ち越します。実際の大会PBも専用に保存します。

## v1.72 の追加CPU

固定の予選組数を確保するため、関西48大学・全国75大学と海外32か国へ参加母数を増やしました。国内の追加選手は上記の実測サンプルの速い層から遅い層までを参照し、現在不足しているタイム帯から生成PBの目標を選びます。大会内の最速記録も参加PBより遅い場合があるため、標準より遅い裾は参加標準の直前へ連続的に対応させ、先頭集団だけの複製を防ぎます。通常選手の目標は実測の先頭15％を除いた層から選び、少数の突出した選手は別の上限を使います。実測順位の間隔を連続補間するため、二つの固定グループや同じタイムに揃えません。

50m・100m・200m・400mの参照順位から同一泳法の能力を同時に合わせ、最後に出場種目の目標へ補正します。IMは4泳法の平均に最大±20の固定適性を加える仕様を維持し、IM適性の高い追加選手を選ぶことで、派遣・国内参加標準を満たすために4泳法すべてを日本記録級へ引き上げることを防ぎます。追加候補の能力から算出する全種目PBを比較し、上位50人の幅と200mの1秒区間への集中も検査して候補を選びます。能力からのレース計算は自チームと共通です。

新規登録は旧セーブの初回更新・新規開始・4月の年度更新で不足分のみ行います。既存選手の能力・PB・記録を書き換えたり、年数に比例した強化を加えたりしません。追加CPUも既存CPUと同じ年齢・進級・卒業・引退の対象とし、自チームの新入生8人は従来どおり既存スカウト候補から選びます。

## 高校生：2026年全国高校総体

「最速」「8番目」は同一選手の予選・決勝をまとめた値です。

| 種目 | 予選有効人数 | 決勝有効人数 | 最速 | 8番目 | 公式予選 | 公式決勝 |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| fr200 | 49 | 8 | 1:50.28 | 1:52.18 | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/02R026.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/02R044.pdf) |
| ba200 | 57 | 8 | 2:00.84 | 2:03.30 | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/03R048.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/03R064.pdf) |
| br200 | 43 | 8 | 2:10.15 | 2:13.18 | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/01R006.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/01R018.pdf) |
| fly200 | 58 | 8 | 1:57.57 | 2:01.25 | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/02R024.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/02R042.pdf) |
| im200 | 41 | 8 | 2:01.11 | 2:03.28 | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/01R004.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/01R016.pdf) |
| fr50 | 78 | 8 | 22.96 | 23.25 | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/02R022.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/02R040.pdf) |
| fr100 | 54 | 8 | 49.47 | 50.92 | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/04R072.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/04R080.pdf) |
| fr400 | 50 | 8 | 3:53.03 | 3:58.08 | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/01R002.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/01R014.pdf) |
| ba100 | 47 | 8 | 55.47 | 56.39 | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/02R028.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/02R046.pdf) |
| br100 | 47 | 8 | 1:00.86 | 1:02.25 | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/03R052.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/03R068.pdf) |
| fly100 | 68 | 8 | 52.59 | 54.60 | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/03R050.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/03R066.pdf) |
| im400 | 46 | 8 | 4:19.79 | 4:25.59 | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/04R074.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70301/ranking/04R082.pdf) |

## 社会人の参照：2026年第102回日本選手権

「最速」「8番目」は同一選手の予選・決勝をまとめた値です。

| 種目 | 予選有効人数 | 決勝有効人数 | 最速 | 8番目 | 公式予選 | 公式決勝 |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| fr200 | 34 | 8 | 1:45.65 | 1:48.54 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/02R025.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/02R041.pdf) |
| ba200 | 44 | 8 | 1:55.62 | 1:59.70 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/03R052.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/03R070.pdf) |
| br200 | 43 | 8 | 2:07.31 | 2:11.18 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/03R053.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/03R071.pdf) |
| fly200 | 47 | 8 | 1:55.03 | 1:57.43 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/02R030.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/02R044.pdf) |
| im200 | 22 | 8 | 1:57.28 | 2:00.45 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/03R049.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/03R067.pdf) |
| fr50 | 44 | 8 | 22.12 | 22.43 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/04R074.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/04R088.pdf) |
| fr100 | 46 | 8 | 48.55 | 49.59 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/03R048.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/03R066.pdf) |
| fr400 | 35 | 8 | 3:46.11 | 3:52.02 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/01R001.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/01R017.pdf) |
| ba50 | 48 | 8 | 24.96 | 25.59 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/04R076.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/04R091.pdf) |
| ba100 | 37 | 8 | 53.85 | 54.75 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/01R008.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/01R024.pdf) |
| br50 | 42 | 8 | 26.76 | 27.72 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/02R031.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/02R045.pdf) |
| br100 | 33 | 8 | 59.11 | 1:00.73 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/01R003.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/01R019.pdf) |
| fly50 | 53 | 8 | 23.28 | 23.55 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/01R005.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/01R021.pdf) |
| fly100 | 56 | 8 | 51.31 | 52.01 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/04R075.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/04R089.pdf) |
| im400 | 44 | 8 | 4:08.66 | 4:17.98 | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/04R079.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70701/ranking/04R095.pdf) |

## 大学生：2026年日本学生選手権

「最速」「8番目」は同一選手の予選・決勝をまとめた値です。

| 種目 | 予選有効人数 | 決勝有効人数 | 最速 | 8番目 | 公式予選 | 公式決勝 |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| fr50 | 108 | 8 | 21.95 | 22.87 | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/04R072.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/04R082.pdf) |
| fr100 | 90 | 8 | 47.95 | 49.85 | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/01R006.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/01R020.pdf) |
| fr400 | 59 | 8 | 3:46.07 | 3:51.33 | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/03R052.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/03R066.pdf) |
| ba100 | 85 | 8 | 53.89 | 55.11 | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/03R048.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/03R058.pdf) |
| br100 | 79 | 8 | 1:00.16 | 1:01.33 | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/02R026.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/02R042.pdf) |
| fly100 | 65 | 8 | 51.27 | 53.10 | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/04R074.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/04R086.pdf) |
| im400 | 61 | 8 | 4:05.83 | 4:18.62 | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/01R002.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/01R012.pdf) |
| fr200 | 76 | 8 | 1:45.09 | 1:49.83 | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/02R022.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/02R034.pdf) |
| ba200 | 60 | 8 | 1:55.90 | 1:59.73 | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/01R004.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/01R016.pdf) |
| br200 | 84 | 8 | 2:10.62 | 2:11.46 | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/04R076.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/04R090.pdf) |
| fly200 | 64 | 8 | 1:55.43 | 1:57.21 | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/02R024.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/02R038.pdf) |
| im200 | 70 | 8 | 1:55.51 | 2:01.39 | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/03R050.pdf) | [PDF](https://swim.seiko.co.jp/2026/S70401/ranking/03R062.pdf) |
