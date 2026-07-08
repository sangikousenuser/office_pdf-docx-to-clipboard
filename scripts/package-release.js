import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import https from "node:https";
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
const packageArch = process.env.QUICKEXPORT_PACKAGE_ARCH || process.arch;
const runtimeNodeVersion = process.env.QUICKEXPORT_NODE_RUNTIME_VERSION || "22.23.1";

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
  await copyBundledRuntime(targetDir);
}

async function copyBundledRuntime(targetDir) {
  const runtimeDir = path.join(targetDir, "runtime");
  const runtimeName = platform === "windows" ? "QuickExportCopyHelper.exe" : "QuickExportCopyHelper";
  const runtimePath = path.join(runtimeDir, runtimeName);
  const nodeDir = await prepareNodeRuntime();
  const nodeBinary = platform === "windows"
    ? path.join(nodeDir, "node.exe")
    : path.join(nodeDir, "bin", "node");

  await mkdir(runtimeDir, { recursive: true });
  await copyFile(nodeBinary, runtimePath);

  if (platform !== "windows") {
    await chmod(runtimePath, 0o755);
  }
}

async function prepareNodeRuntime() {
  const runtimePlatform = platform === "windows" ? "win" : "darwin";
  const archiveExtension = platform === "windows" ? "zip" : "tar.gz";
  const runtimeName = `node-v${runtimeNodeVersion}-${runtimePlatform}-${packageArch}`;
  const downloadDir = path.join(releaseDir, "node-downloads");
  const archivePath = path.join(downloadDir, `${runtimeName}.${archiveExtension}`);
  const extractDir = path.join(releaseDir, "node-runtime");
  const extractedPath = path.join(extractDir, runtimeName);
  const url = `https://nodejs.org/dist/v${runtimeNodeVersion}/${runtimeName}.${archiveExtension}`;

  await mkdir(downloadDir, { recursive: true });
  await mkdir(extractDir, { recursive: true });
  await downloadFile(url, archivePath);

  if (platform === "windows") {
    if (process.platform === "win32") {
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force`
      ]);
    } else {
      await execFileAsync("ditto", ["-x", "-k", archivePath, extractDir]);
    }
  } else {
    await execFileAsync("tar", ["-xzf", archivePath, "-C", extractDir]);
  }

  return extractedPath;
}

function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, outputPath).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        response.resume();
        return;
      }

      const file = createWriteStream(outputPath);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

async function packageMacos() {
  const payloadRoot = path.join(releaseDir, "pkg-root");
  const installRoot = path.join(payloadRoot, "Library", "Application Support", appName);
  const scriptsDir = path.join(releaseDir, "pkg-scripts");
  const pkgPath = path.join(releaseDir, `${appName}-${version}-macos-${packageArch}.pkg`);

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

  const archivePath = path.join(releaseDir, `${appName}-${version}-windows-${packageArch}.zip`);

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
HELPER_BIN="$APP_DIR/runtime/QuickExportCopyHelper"

mkdir -p "$CERT_DIR"
chmod 755 "$HELPER_BIN"

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
    <string>/Library/Application Support/${appName}/runtime/QuickExportCopyHelper</string>
    <string>/Library/Application Support/${appName}/helper/server.js</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LowPriorityIO</key>
  <true/>
  <key>Nice</key>
  <integer>10</integer>
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

$ServerPath = Join-Path $AppDir "helper\server.js"
$HelperBin = Join-Path $AppDir "runtime\QuickExportCopyHelper.exe"
$Action = New-ScheduledTaskAction -Execute $HelperBin -Argument ('"' + $ServerPath + '"')
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
