import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.QUICKEXPORT_HELPER_PORT || 43178);
const WEB_PORT = Number(process.env.QUICKEXPORT_WEB_PORT || 43179);
const MAX_BODY_BYTES = Number(process.env.QUICKEXPORT_MAX_BODY_BYTES || 80 * 1024 * 1024);
const OUTPUT_DIR = path.join(os.tmpdir(), "quickexport-copy");
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = process.env.QUICKEXPORT_DIST_DIR || path.join(APP_ROOT, "dist");
const CERT_DIR = process.env.QUICKEXPORT_CERT_DIR || path.join(APP_ROOT, "certs");

const server = createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, { ok: true, platform: process.platform });
    return;
  }

  if (req.method !== "POST" || req.url !== "/export-copy") {
    sendJson(res, 404, { message: "Not found" });
    return;
  }

  try {
    const payload = JSON.parse(await readRequestBody(req));
    const writtenFiles = await writeExportFiles(payload);
    await copyFilesToClipboard(writtenFiles);
    sendJson(res, 200, { ok: true, files: writtenFiles });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { message: error.message || "Export failed" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`QuickExport helper listening on http://127.0.0.1:${PORT}`);
});

startWebServer().catch((error) => {
  console.error(`QuickExport web server was not started: ${error.message}`);
});

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let byteLength = 0;

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      byteLength += Buffer.byteLength(chunk);
      if (byteLength > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }

      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function writeExportFiles(payload) {
  if (!payload || !Array.isArray(payload.files) || payload.files.length !== 2) {
    throw new Error("Expected exactly two files.");
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const baseName = sanitizeBaseName(payload.baseName || "document");
  const timestamp = formatTimestamp(new Date());

  return Promise.all(payload.files.map(async (file) => {
    if (!["docx", "pdf"].includes(file.extension)) {
      throw new Error(`Unsupported file extension: ${file.extension}`);
    }

    if (typeof file.dataBase64 !== "string" || file.dataBase64.length === 0) {
      throw new Error(`Missing data for .${file.extension}`);
    }

    const filePath = path.join(OUTPUT_DIR, `${baseName}_${timestamp}.${file.extension}`);
    await writeFile(filePath, Buffer.from(file.dataBase64, "base64"));
    return filePath;
  }));
}

function sanitizeBaseName(value) {
  return String(value)
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "document";
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "_" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

async function copyFilesToClipboard(filePaths) {
  if (process.platform === "win32") {
    await copyFilesToWindowsClipboard(filePaths);
    return;
  }

  if (process.platform === "darwin") {
    await copyFilesToMacClipboard(filePaths);
    return;
  }

  throw new Error(`Unsupported platform: ${process.platform}`);
}

async function copyFilesToWindowsClipboard(filePaths) {
  const psPaths = filePaths.map((filePath) => `'${filePath.replaceAll("'", "''")}'`).join(",");
  await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-WindowStyle",
    "Hidden",
    "-Command",
    `Set-Clipboard -Path ${psPaths}`
  ]);
}

async function copyFilesToMacClipboard(filePaths) {
  const python = `
import os
import sys
from AppKit import NSPasteboard, NSFilenamesPboardType

pb = NSPasteboard.generalPasteboard()
pb.clearContents()
paths = [os.path.abspath(p) for p in sys.argv[1:]]
if not pb.setPropertyList_forType_(paths, NSFilenamesPboardType):
    raise SystemExit("Failed to write file paths to NSPasteboard.")
`;

  try {
    await execFileAsync("/usr/bin/python3", ["-c", python, ...filePaths]);
    return;
  } catch (error) {
    const script = `set the clipboard to {${filePaths.map((filePath) => `POSIX file "${escapeAppleScript(filePath)}"`).join(", ")}}`;
    await execFileAsync("osascript", ["-e", script]);
  }
}

function escapeAppleScript(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function startWebServer() {
  if (!existsSync(DIST_DIR)) {
    console.log(`QuickExport web dist not found at ${DIST_DIR}; skipping web server.`);
    return;
  }

  const keyPath = path.join(CERT_DIR, "localhost-key.pem");
  const certPath = path.join(CERT_DIR, "localhost-cert.pem");
  const pfxPath = path.join(CERT_DIR, "localhost.pfx");
  let options;

  if (existsSync(keyPath) && existsSync(certPath)) {
    options = {
      key: await readFile(keyPath),
      cert: await readFile(certPath)
    };
  } else if (existsSync(pfxPath)) {
    options = {
      pfx: await readFile(pfxPath),
      passphrase: process.env.QUICKEXPORT_CERT_PASSPHRASE || "quickexport"
    };
  } else {
    console.log(`QuickExport TLS certs not found at ${CERT_DIR}; skipping web server.`);
    return;
  }

  createHttpsServer(options, async (req, res) => {
    try {
      await serveStaticFile(req, res);
    } catch (error) {
      console.error(error);
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  }).listen(WEB_PORT, "127.0.0.1", () => {
    console.log(`QuickExport web add-in listening on https://127.0.0.1:${WEB_PORT}`);
  });
}

async function serveStaticFile(req, res) {
  const url = new URL(req.url || "/", `https://127.0.0.1:${WEB_PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(DIST_DIR, safePath);

  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (pathname === "/" || pathname.endsWith("/")) {
    filePath = path.join(filePath, "index.html");
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error("Not a file");
    }
  } catch {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentType(filePath),
    "Cache-Control": "no-cache"
  });
  createReadStream(filePath).pipe(res);
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml"
  }[extension] || "application/octet-stream";
}
