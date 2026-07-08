import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const version = process.env.npm_package_version || "0.1.0";
const platformArg = process.argv.find((arg) => arg.startsWith("--platform="));
const platform = platformArg?.split("=")[1] || (process.platform === "darwin" ? "macos" : "windows");
const releaseDir = path.join(root, "release");
const appName = "QuickExportCopy";
const appDir = path.join(releaseDir, appName);

await rm(releaseDir, { recursive: true, force: true });
await mkdir(appDir, { recursive: true });

await copyRequiredFiles(appDir);

if (platform === "macos") {
  await packageMacos();
} else if (platform === "windows") {
  await packageWindows();
} else {
  throw new Error(`Unsupported package platform: ${platform}`);
}

async function copyRequiredFiles(targetDir) {
  await cp(path.join(root, "dist"), path.join(targetDir, "dist"), { recursive: true });
  await cp(path.join(root, "helper"), path.join(targetDir, "helper"), { recursive: true });
  await copyFile(path.join(root, "manifest.xml"), path.join(targetDir, "manifest.xml"));
  await copyFile(path.join(root, "package.json"), path.join(targetDir, "package.json"));
  await copyFile(path.join(root, "README.md"), path.join(targetDir, "README.md"));
}

async function packageMacos() {
  const payloadRoot = path.join(releaseDir, "pkg-root");
  const installRoot = path.join(payloadRoot, "Library", "Application Support", appName);
  const scriptsDir = path.join(releaseDir, "pkg-scripts");
  const pkgPath = path.join(releaseDir, `${appName}-${version}-macos.pkg`);

  await mkdir(installRoot, { recursive: true });
  await cp(appDir, installRoot, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });
  await writeFile(path.join(scriptsDir, "postinstall"), macosPostinstall(), { mode: 0o755 });

  await execFileAsync("pkgbuild", [
    "--root",
    payloadRoot,
    "--scripts",
    scriptsDir,
    "--identifier",
    "com.quickexport.copy",
    "--version",
    version,
    "--install-location",
    "/",
    pkgPath
  ]);

  console.log(pkgPath);
}

async function packageWindows() {
  await writeFile(path.join(appDir, "install.ps1"), windowsInstallScript());
  await writeFile(path.join(appDir, "uninstall.ps1"), windowsUninstallScript());

  const archivePath = path.join(releaseDir, `${appName}-${version}-windows.zip`);

  if (process.platform === "win32") {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${appDir}\\*' -DestinationPath '${archivePath}' -Force`
    ]);
  } else {
    await execFileAsync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appDir, archivePath]);
  }

  console.log(archivePath);
}

function macosPostinstall() {
  return `#!/bin/sh
set -eu

APP_DIR="/Library/Application Support/${appName}"
CERT_DIR="$APP_DIR/certs"
CONSOLE_USER="$(stat -f %Su /dev/console)"
USER_HOME="$(dscl . -read "/Users/$CONSOLE_USER" NFSHomeDirectory | awk '{print $2}')"
NODE_BIN="$(command -v node || true)"

mkdir -p "$CERT_DIR"

if [ ! -f "$CERT_DIR/localhost-cert.pem" ] || [ ! -f "$CERT_DIR/localhost-key.pem" ]; then
  /usr/bin/openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \\
    -keyout "$CERT_DIR/localhost-key.pem" \\
    -out "$CERT_DIR/localhost-cert.pem" \\
    -subj "/CN=127.0.0.1" \\
    -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"
fi

/usr/bin/security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CERT_DIR/localhost-cert.pem" >/dev/null 2>&1 || true
chmod 644 "$CERT_DIR/localhost-cert.pem" "$CERT_DIR/localhost-key.pem"

WEF_DIR="$USER_HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef"
mkdir -p "$WEF_DIR"
cp "$APP_DIR/manifest.xml" "$WEF_DIR/quickexport-copy-manifest.xml"
chown -R "$CONSOLE_USER":staff "$WEF_DIR"

LAUNCH_AGENT_DIR="$USER_HOME/Library/LaunchAgents"
PLIST="$LAUNCH_AGENT_DIR/com.quickexport.copy.plist"
mkdir -p "$LAUNCH_AGENT_DIR"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.quickexport.copy</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>node '$APP_DIR/helper/server.js'</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/quickexport-copy.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/quickexport-copy.err</string>
</dict>
</plist>
PLIST

chown "$CONSOLE_USER":staff "$PLIST"
launchctl bootout "gui/$(id -u "$CONSOLE_USER")" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u "$CONSOLE_USER")" "$PLIST" >/dev/null 2>&1 || true
launchctl kickstart -k "gui/$(id -u "$CONSOLE_USER")/com.quickexport.copy" >/dev/null 2>&1 || true

if [ -z "$NODE_BIN" ]; then
  echo "Node.js is required to run QuickExport Copy." >&2
fi

exit 0
`;
}

function windowsInstallScript() {
  return String.raw`$ErrorActionPreference = "Stop"

$AppDir = Join-Path $env:LOCALAPPDATA "QuickExportCopy"
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$CertDir = Join-Path $AppDir "certs"
$ManifestTarget = Join-Path $env:USERPROFILE "Documents\QuickExportCopy\manifest.xml"

New-Item -ItemType Directory -Force -Path $AppDir, $CertDir, (Split-Path -Parent $ManifestTarget) | Out-Null
Copy-Item -Recurse -Force (Join-Path $SourceDir "*") $AppDir
Copy-Item -Force (Join-Path $AppDir "manifest.xml") $ManifestTarget

$Cert = New-SelfSignedCertificate -DnsName "localhost", "127.0.0.1" -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(2)
$CertPath = Join-Path $CertDir "localhost-cert.cer"
$PfxPath = Join-Path $CertDir "localhost.pfx"
$PfxPassword = ConvertTo-SecureString -String "quickexport" -Force -AsPlainText
Export-Certificate -Cert $Cert -FilePath $CertPath | Out-Null
Export-PfxCertificate -Cert $Cert -FilePath $PfxPath -Password $PfxPassword | Out-Null
Import-Certificate -FilePath $CertPath -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null

$Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $Node) {
  throw "Node.js is required. Install Node.js, then run install.ps1 again."
}

$ServerPath = Join-Path $AppDir "helper\server.js"
$Action = New-ScheduledTaskAction -Execute $Node -Argument ('"' + $ServerPath + '"')
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege
Register-ScheduledTask -TaskName "QuickExportCopy" -Action $Action -Trigger $Trigger -Principal $Principal -Force | Out-Null
Start-ScheduledTask -TaskName "QuickExportCopy"

Write-Host "Installed QuickExport Copy."
Write-Host "Manifest copied to: $ManifestTarget"
Write-Host "For Word on Windows, add the manifest through your trusted add-in catalog or sideload flow."
`;
}

function windowsUninstallScript() {
  return String.raw`$ErrorActionPreference = "SilentlyContinue"

Unregister-ScheduledTask -TaskName "QuickExportCopy" -Confirm:$false
Remove-Item -Recurse -Force (Join-Path $env:LOCALAPPDATA "QuickExportCopy")
Remove-Item -Force (Join-Path $env:USERPROFILE "Documents\QuickExportCopy\manifest.xml")
Write-Host "Uninstalled QuickExport Copy."
`;
}
