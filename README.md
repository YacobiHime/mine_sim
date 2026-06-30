# mine_sim × MineColonies 統合プロジェクト

MineColonies（Forge mod）と mine_sim（mineflayer ボット）を統合し、LLMがコロニーを指揮するシミュレーションシステム。

## 概要

このプロジェクトは以下の2つのモードで動作します：

### フル統合モード
実際のMinecraft Forgeサーバー（MineColonies mod導入）と連携して動作します。

- **MineColonies**: MinecraftのForge modで、コロニー建設・市民管理・自動化を行うJavaベースのシステム
- **mine_sim**: Node.js/mineflayerベースのLLM指導者ボット

LLM指導者がMineColoniesの `/mc` コマンドを通じてコロニーを運営します。

### サーバーレスモード（開発・テスト用）
Minecraftサーバーなしで、コロニーシミュレーションのみを動作させます。

- 実際のゲーム接続なしで、エージェントのLLM判断ロジックをテスト可能
- コロニー状態管理・資源管理・エージェント会話などのシミュレーションが動作
- 開発環境やテスト環境での使用に最適

## 構成

```
mine_sim/
├── minecolonies/           ← MineColonies ソース（22,382ファイル）
│   └── src/main/java/     ← コロニーロジック全体
├── server/                 ← Forgeサーバー実行環境
│   ├── setup.sh           ← サーバーセットアップスクリプト
│   ├── start.sh           ← サーバー起動スクリプト
│   └── config/            ← MineColonies 設定
├── src/
│   ├── bridge/
│   │   └── ColonyBridge.js ← MineColonies ↔ JS ブリッジ
│   ├── agents/
│   │   ├── BaseAgent.js
│   │   ├── LeaderAgent.js  ← LLM指導者（MineColonies操作版）
│   │   ├── BuilderAgent.js
│   │   ├── FarmerAgent.js
│   │   └── GuardAgent.js
│   ├── colony/
│   │   └── Colony.js
│   ├── statemachine/
│   │   └── StateMachine.js
│   ├── llm/
│   │   └── LLMClient.js
│   ├── config.js
│   └── index.js
└── package.json
```

## 動作イメージ

```
[Forgeサーバー]                         [mine_sim / Node.js]
  MineColonies mod が動作           →   mineflayer ボット（Leader_Alex）が接続
  市民AIが自律的にコロニーを運営     ←   LLMが /mc コマンドで指揮
  建物建設・農業・警備               →   チャット出力を ColonyBridge が解析
  レイドイベントが発生               ←   LeaderAgent が LLM判断で対応指令
```

## 動作モード

本システムは2つのモードで動作します：

### モード1: フル統合モード（サーバーあり）

実際のMinecraft Forgeサーバー（MineColonies mod導入）と連携して動作します。

```
[Forgeサーバー]                         [mine_sim / Node.js]
  MineColonies mod が動作           →   mineflayer ボット（Leader_Alex）が接続
  市民AIが自律的にコロニーを運営     ←   LLMが /mc コマンドで指揮
  建物建設・農業・警備               →   チャット出力を ColonyBridge が解析
  レイドイベントが発生               ←   LeaderAgent が LLM判断で対応指令
```

**必要な環境:**
- Ubuntu マイクラサーバー（Forge + MineColonies mod）
- LLMサーバー（Ollama等）
- クライアント（mine_sim）

### モード2: サーバーレスモード（開発・テスト用）

Minecraftサーバーなしで、コロニーシミュレーションのみを動作させます。

```
[サーバーレス環境]
  コロニー状態のシミュレーション     →   エージェントがLLMで行動決定
  資源管理・建築キュー管理           ←   LeaderAgentが戦略判断
  エージェント同士の会話             →   状況に応じた発話生成
```

**用途:**
- LLM判断ロジックの開発・テスト
- エージェントAIの挙動確認
- Minecraftサーバーを用意できない環境での動作確認

---

## セットアップ

### 共通セットアップ

```bash
# プロジェクト取得
git clone <repo>
cd mine_sim

# 依存インストール
npm install

# 環境変数設定（.envファイルを使用）
```

**.envファイルの設定例:**

サーバーレスモード（開発・テスト用）:
```bash
# .env
SERVERLESS=true
OLLAMA_URL=http://localhost:11434/v1
OLLAMA_MODEL=gemma4:e4b
```

フル統合モード:
```bash
# .env
MC_HOST=192.168.15.10
MC_PORT=25565
MC_VERSION=1.20.1
OLLAMA_URL=http://192.168.15.150:11434/v1
OLLAMA_MODEL=gemma4:e4b
```

---

### 🟩 統合モード（サーバーPCで完結）

**Forgeサーバーとmine_simエージェントを同一PC上で動作させるモードです。**

```
┌─────────────────────────────────────────────────────────────┐
│              サーバーPC（1台で完結）                         │
│                                                             │
│  ┌─────────────────┐         ┌─────────────────┐           │
│  │  Forgeサーバー  │         │  mine_sim       │           │
│  │  localhost:25565│◄────────┤  エージェント    │           │
│  └─────────────────┘         └─────────────────┘           │
│         ↓                           ↑                       │
│  MineColonies mod              LLM判断                     │
└─────────────────────────────────────────────────────────────┘
                              ↕ 別のPC
                      ┌─────────────────┐
                      │  Ollama         │
                      │  192.168.15.150 │
                      └─────────────────┘
```

**メリット:**
- 1台のPCで完結するのでセットアップが簡単
- ローカル接続なので低遅延
- 開発・テストに最適

**.env設定:**
```bash
# .env
MC_HOST=localhost              # ローカル接続
MC_PORT=25565
MC_VERSION=1.20.1
OLLAMA_URL=http://192.168.15.150:11434/v1  # Ollamaは別PC
OLLAMA_MODEL=gemma4:e4b
```

**起動方法:**

1. **方法1: 一括起動（推奨）**
```bash
cd server
bash integrated_start.sh
```

2. **方法2: 個別起動**
```bash
# ターミナル1: Forgeサーバー起動
cd server
bash start.sh

# ターミナル2: mine_sim起動
npm start
```

**必要な環境:**
- Java 17
- Node.js 18+
- Ollamaサーバー（別PC可）

---

### 🟦 フル統合モードのセットアップ（3台構成・従来方式）

本システムは3つの環境で動作します：

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   Ubuntu        │         │   LLMサーバー   │         │   クライアント  │
│   マイクラ鯖     │◄────────┤   (Ollama)      │◄────────┤   (mine_sim)    │
│  192.168.15.10  │         │ 192.168.15.150  │         │                 │
│  Port: 25565    │         │  Port: 11434    │         │                 │
└─────────────────┘         └─────────────────┘         └─────────────────┘
    Forge+MineColonies          LLM API提供          mineflayerボット
```

---

### 🟦 Ubuntu マイクラサーバー側

Forge + MineColonies mod を動かすサーバーです。

**必要なもの:**
- Java 17
- Forge 47.3.12（Minecraft 1.20.1 用）

**必要な mod:**
- MineColonies 1.1.603-RELEASE
- Structurize 1.0.742-RELEASE
- Domum Ornamentum 1.0.196-BETA
- BlockUI 1.0.194

```bash
# 1. Java 17 インストール
sudo apt update
sudo apt install openjdk-17-jdk
java -version

# 2. プロジェクトの server/ ディレクトリをアップロード
# （Git clone または scp 等で転送）

# 3. セットアップ実行（Forge + mods 自動ダウンロード）
cd server
bash setup.sh

# 4. ポート開放
sudo ufw allow 25565

# 5. サーバー起動
bash start.sh
```

> setup.sh は CurseForge から以下の mod をダウンロードします：
> - MineColonies 1.1.603-RELEASE
> - Structurize 1.0.742-RELEASE
> - Domum Ornamentum 1.0.196-BETA
> - BlockUI 1.0.194

---

### 🟩 LLMサーバー側

Ollama などでLLM APIを提供するサーバーです。

```bash
# 1. Ollama インストール
curl -fsSL https://ollama.com/install.sh | sh

# 2. モデルダウンロード
ollama pull gemma4:e4b
# または
ollama pull llama3

# 3. ポート開放
sudo ufw allow 11434

# 4. APIサーバー起動
ollama serve
```

---

### 🟧 クライアント側（mine_sim）

mineflayerボット（mine_sim）を動かすマシンです。

```bash
# 起動
npm start
```

.envファイルの設定により、以下の2つのモードが自動的に切り替わります：

- `SERVERLESS=true` の場合: サーバーレスモードで起動
- `MC_HOST` が設定されている場合: フル統合モードで起動

---

### 🟨 ゲーム内で様子を見る（プレイヤーとして参加）

mine_sim のシミュレーションを実際にMinecraftゲーム内で目で見たい場合の手順です。

**注意**: mine_sim 自体は Minecraft クライアントアプリを不要ですが、ゲーム内で様子を見るには Minecraft の購入・インストールが必要です。

#### 手順

**1. Minecraft 1.20.1 をインストール**

- Minecraft Launcher をダウンロード・インストール
- Launcher で「インストール」タブ →「新規作成」
- バージョン: `1.20.1` を選択してインストール

**2. Forge 47.3.12 をインストール**

- [Forge Installer](https://files.minecraftforge.net/) から 1.20.1 用をダウンロード
  - バージョン **47.3.12**（推奨安定版）
- インストーラーを実行し、「Install client」を選択

**3. 必要な mod をインストール**

サーバーの `server/libs/` フォルダにある以下のJARファイルを `.minecraft/mods/` にコピーします：

```
.minecraf/mods/
├── minecolonies-1.1.603-RELEASE.jar
├── structurize-1.0.742-RELEASE.jar
├── domum_ornamentum-1.0.196-BETA.jar
└── blockui-1.0.194.jar
```

または CurseForge からダウンロード：
- [MineColonies](https://www.curseforge.com/minecraft/mc-mods/minecolonies)
- [Structurize](https://www.curseforge.com/minecraft/mc-mods/structurize)
- [Domum Ornamentum](https://www.curseforge.com/minecraft/mc-mods/domum-ornamentum)
- [BlockUI](https://www.curseforge.com/minecraft/mc-mods/block-ui)

**4. サーバーに接続**

- Minecraft Launcher を起動
- 「Forge」バージョンを選択して起動
- マルチプレイ → サーバー追加
  - サーバーアドレス: `<UbuntuサーバーのIP>:25565`（例: `192.168.15.10:25565`）

**5. 様子を見る**

サーバーに接続すると、以下が見えます：

- 🤖 **Leader_Alex**（mineflayerボット）がチャットで指令を出している
- 👷 **Builder_Bob** が木を伐採・建築している
- 🌾 **Farmer_Carol** が農業をしている
- ⚔️ **Guard_Dave** が巡回・警備している
- 🏘️ **MineColoniesのコロニー** が発展していく

チャットで指示を出すこともできます：
```
家を10軒建てろ
食料が足りない、農業を優先しろ
西側を防衛強化せよ
```

#### なぜ 1.20.1 なのか？

使用している **MineColonies 1.1.603-RELEASE** は **Minecraft 1.20.1 用** にビルドされたバージョンです。

**バージョン選定の理由:**

| 理由 | 説明 |
|------|------|
| **mod の成熟度** | 1.20.1 は mod 開発の黄金期。多数の mod が対応し、バグfixも進んでいる |
| **安定性** | MineColonies 1.1.603-RELEASE は 1.20.1 で最も安定したリリース |
| **Forge 対応** | 1.20.4 以降は NeoForge が主流。1.20.1 は Forge が安定 |
| **情報の豊富さ** | トラブルシューティングの情報が豊富 |

**Forge vs NeoForge の分岐:**
```
1.20.1  ──→ Forge（このプロジェクト）
   │
1.20.4  ──→ NeoForge が主流に
1.21.x  ──→ NeoForge のみ
```

バージョン対応表：
| Minecraft バージョン | 対応する MineColonies バージョン | Modローダー |
|---------------------|--------------------------------|------------|
| 1.20.1 | 1.1.603-RELEASE（現行） | **Forge** |
| 1.20.4+ | 1.20.x 系 | **NeoForge** |
| 1.21.x | 1.21.x 系 | **NeoForge** |
| 1.19.2 | 1.0.590-RELEASE | Forge |
| 1.18.2 | 0.13.800-RELEASE | Forge |

#### 最新版への移行方針

**まずは 1.20.1 + Forge で動作確認してから、必要に応じて NeoForge へ移行することをお勧めします。**

**移行時の必要な作業:**
- Minecraft、Forge/NeoForge、全modのバージョンを一括変更
- `server/setup.sh` のダウンロードURLを書き換え
- mineflayer（mine_sim）は影響なし（プロトコルは互換）

1.20.1 は mod エコシステムが成熟しており、まずは安定した環境で動作確認するのが良いでしょう。

#### Forge は必要か？

| 側 | Forgeが必要？ | 理由 |
|---|-------------|------|
| **Ubuntuサーバー** | ✅ **必要** | MineColoniesはForge mod |
| **クライアント（mine_sim）** | ❌ **不要** | mineflayerはNode.jsプログラム |
| **ゲーム内でプレイ** | ✅ **必要** | サーバーに接続してプレイするため |

---

### 🟪 サーバーレスモード詳細

サーバーレスモードでは、以下の機能がシミュレートされます：

| 機能 | フル統合モード | サーバーレスモード |
|------|----------------|-------------------|
| Minecraftサーバー接続 | ✅ 接続 | ❌ 接続なし |
| エージェントスポーン | ゲーム内にスポーン | シミュレート済み |
| ブロック操作 | 実行 | スキップ（ログのみ） |
| 移動・探索 | pathfinder使用 | スキップ（ログのみ） |
| LLM行動決定 | ✅ 動作 | ✅ 動作 |
| コロニー状態管理 | ✅ 動作 | ✅ 動作 |
| エージェント会話 | ✅ 動作 | ✅ 動作 |

**サーバーレスモードでのログ出力例:**
```
[Leader_Alex] 💬 コロニーの設立を開始します
[Builder_Bob] 💬 さあ、建物を建てるために、木をたくさん集めよう！
[Farmer_Carol] 💬 さっそく畑を耕して種をまこうか
[Colony] [Day1] 新しい日が始まりました (Day 1)
```

## MineColonies コマンド対応

ColonyBridge は以下の `/mc` コマンド出力を解析します：

| コマンド | 取得情報 |
|---|---|
| `/mc colony info <id>` | コロニー名、市民数、中心座標 |
| `/mc citizen list <colonyId>` | 市民名・職業リスト |
| `/mc citizen info <id> <cId>` | 個別市民の状態（健康・幸福度） |
| `/mc colony raid <id> tonight` | レイドをトリガー |

## LLM指導者の機能

LeaderAgent は以下の判断を行います：

- コロニー状態の定期更新（5秒ごと）
- LLMによる戦略判断（10秒ごと）
- 市民のスポーン
- 建設指示
- 防衛指令（レイド時）

## 参照した MineColonies ソース

| ファイル | 参照目的 |
|---|---|
| `CitizenAI.java` | 状態遷移の優先度構造 |
| `CommandColonyInfo.java` | コロニー情報コマンドの出力形式 |
| `CommandCitizenList.java` | 市民リストの出力形式 |
| `AbstractEntityAIBasic.java` | tick() 構造・状態遷移 |
| `ThreatTable.java` | 脅威テーブルの距離係数 |

## プレイヤーからの指示

ゲーム内チャットで指示を送ると、Leaderエージェントが受け取りコロニーログに追記。

例：
```
家を10軒建てろ
食料が足りない、農業を優先しろ
西側を防衛強化せよ
```

## 今後の拡張

- MineColonies パケットプロトコルへの直接接続
- 建物スキャンによる状態推定精度向上
- Structurize 連携による建設完全自動化
- マルチコロニー管理
