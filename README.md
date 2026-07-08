# office_pdf-docx-to-clipboard

Wordのリボンボタンから、現在の文書をPDFとDOCXとして出力し、2ファイルをOSのクリップボードへファイルオブジェクトとしてコピーするOffice Web Add-inです。

## 構成

- `manifest.xml`: 配布版Word用Office Add-in manifest。`https://127.0.0.1:43179` のローカルWebサーバーを参照します。
- `manifest.dev.xml`: 開発版manifest。Vite dev serverの `https://127.0.0.1:5173` を参照します。
- `src/`: Office.js側のリボンコマンドとタスクペイン。
- `helper/server.js`: `http://127.0.0.1:43178` のクリップボードAPIと、配布版の `https://127.0.0.1:43179` 静的Webサーバー。
- `.github/workflows/build-release.yml`: `main` pushで検証、`v*` tagで配布物を生成してGitHub Releaseへ添付します。

## 開発起動

```bash
npm install
npm start
```

ViteはOffice Add-in要件に合わせてHTTPSで起動します。Wordへは `manifest.xml` をサイドロードしてください。

macOSのWordサイドロード先:

```text
/Users/<username>/Library/Containers/com.microsoft.Word/Data/Documents/wef
```

Windowsでは共有フォルダーを信頼済みアドインカタログに設定し、`manifest.xml` を配置します。

## GitHub Actionsでのリリース

`main`へpushすると検証とWebビルドが走ります。

タグをpushすると、GitHub Actionsが以下を生成してGitHub Releaseへ添付します。

- `QuickExportCopy-<version>-macos-x64.pkg` Intel Mac向け
- `QuickExportCopy-<version>-macos-arm64.pkg` Apple Silicon Mac向け
- `QuickExportCopy-<version>-windows-x64.zip`

```bash
git tag v0.1.5
git push origin main v0.1.5
```

## 配布物の注意

- macOS `.pkg` はアプリ本体を `/Library/Application Support/QuickExportCopy` に配置し、Word用manifestをユーザーの `wef` フォルダへコピーし、LaunchAgentを登録します。
- Windows ZIPには `install.ps1` / `uninstall.ps1` が含まれます。PowerShellで `install.ps1` を実行すると、ローカルアプリ配置、証明書作成、ログオン時タスク登録を行います。
- WindowsのWordへのmanifest登録は、組織の信頼済みアドインカタログまたはサイドロード手順に合わせて行ってください。スクリプトはmanifestを `Documents\QuickExportCopy\manifest.xml` にコピーします。
- Node.jsは配布物に同梱されます。利用者PCへ別途Node.jsをインストールする必要はありません。
- macOSの常駐プロセスは同梱ランタイム `QuickExportCopyHelper` を直接起動します。`zsh` 経由では起動しません。

## ローカル証明書について

Office Web Add-inはHTTPSで配信される必要があります。配布版はインターネット上のサーバーではなくPC内の `https://127.0.0.1:43179` から画面とコマンドを配信するため、インストール時にローカル用の自己署名証明書を作成し、OSの信頼ストアへ登録します。

この証明書はローカルホスト専用で、外部サイトの通信を復号する用途ではありません。

## 実装メモ

- DOCXは `Office.FileType.Compressed`、PDFは `Office.FileType.Pdf` を `Document.getFileAsync` で取得します。
- ヘルパーはOS一時フォルダ配下の `quickexport-copy` に `[ファイル名]_[日時].docx` と `[ファイル名]_[日時].pdf` を書き出します。
- Windowsは `Set-Clipboard -Path`、macOSはPyObjCの `NSPasteboard` を優先し、失敗時にAppleScriptへフォールバックします。
- GitHub Actions上でmacOS `.pkg` とWindows ZIPインストーラーを生成します。Windows `.msi` はWiX等のMSIビルド定義を追加する次工程です。
