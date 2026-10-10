# CPUの能力・PB分布の参照記録（v1.65）

男子・長水路。2026年のSEIKO公式結果から予選・決勝78ファイルを参照しました。各選手の予選と決勝の速い方を一度だけ集計し、上位だけでなく予選全体の広がりを数値サンプルとしてHTMLへ同梱しています。これは大会内の最速記録であり、実在選手の生涯PB一覧ではありません。架空選手の名前・学校・戦績はゲーム内で生成します。

CPUのタイムだけを散らさず、同じ泳法の50m・100m・200m・400mを同時に近似するよう、スピード・スタミナ・ターンを調整します。IM専門選手は公式IMの分布も参照し、4泳法の平均と固定適性から算出するIM能力で合わせます。能力からレースのタイムを出す式は自チームと共通です。

カテゴリ・種目ごとに実際の順位間隔を参照し、保存した乱数シードの大会レベル・間隔補正を加えます。毎年同じ順位・人数・タイムには固定しません。元の生成能力から参照分布へ対応させる変換は初回に保存し、選手ごと・カテゴリごとに一度だけ適用します。既存選手の毎年の再順位付けや能力への重複加算は行いません。

中学生は高校生の分布より9％遅いゲーム内基準です。高校・大学に存在しない50mBa・Br・Flyは、日本選手権の50m分布を、各カテゴリの100mと日本選手権100mの同順位比率で調整した推定値です。社会人の参照にした日本選手権には学生も出場するため、国内トップ層の基準として使用しています。公式大会よりCPU人数が多い場合、参照人数の先は元の弱い選手の広がりまで補間して裾を延ばします。

この調整は生成されたCPUの基本能力・初期PBを対象とします。自チーム、卒業生、スカウト済み選手の基本能力・PBと、保存済みの10傑・大会の記録は保持します。旧セーブのCPUについては保存済みの記録表・肩書・戦績に残っている最速記録を保持し、初回調整後のCPUのPBは生成PBも含めて次のカテゴリへ持ち越します。実際の大会PBも専用に保存します。

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
