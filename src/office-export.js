const HELPER_ORIGIN = "http://127.0.0.1:43178";

export async function exportPdfAndDocx(status = () => {}) {
  status("文書を読み取っています...");

  const [docxBase64, pdfBase64] = await Promise.all([
    getOfficeFileAsBase64(Office.FileType.Compressed),
    getOfficeFileAsBase64(Office.FileType.Pdf)
  ]);

  status("ローカルヘルパーへ送信しています...");

  const response = await fetch(`${HELPER_ORIGIN}/export-copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      baseName: getDocumentBaseName(),
      files: [
        { extension: "docx", dataBase64: docxBase64 },
        { extension: "pdf", dataBase64: pdfBase64 }
      ]
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Helper request failed: ${response.status}`);
  }

  const result = await response.json();
  status("PDFとDOCXをクリップボードにコピーしました（Ctrl+V / Cmd+V で貼り付け可能）");
  return result;
}

function getDocumentBaseName() {
  const url = Office.context.document.url || "document";
  const rawName = decodeURIComponent(url.split(/[\\/]/).pop() || "document");
  return rawName.replace(/\.[^.]+$/, "") || "document";
}

function getOfficeFileAsBase64(fileType) {
  return new Promise((resolve, reject) => {
    Office.context.document.getFileAsync(fileType, { sliceSize: 1024 * 1024 }, (result) => {
      if (result.status !== Office.AsyncResultStatus.Succeeded) {
        reject(new Error(result.error?.message || "Failed to read the Office document."));
        return;
      }

      const file = result.value;
      const slices = [];

      readSlice(file, 0, slices, (error) => {
        file.closeAsync();

        if (error) {
          reject(error);
          return;
        }

        resolve(bytesToBase64(concatSlices(slices)));
      });
    });
  });
}

function readSlice(file, index, slices, done) {
  if (index >= file.sliceCount) {
    done();
    return;
  }

  file.getSliceAsync(index, (result) => {
    if (result.status !== Office.AsyncResultStatus.Succeeded) {
      done(new Error(result.error?.message || `Failed to read slice ${index}.`));
      return;
    }

    slices[index] = new Uint8Array(result.value.data);
    readSlice(file, index + 1, slices, done);
  });
}

function concatSlices(slices) {
  const totalLength = slices.reduce((sum, slice) => sum + slice.length, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;

  for (const slice of slices) {
    bytes.set(slice, offset);
    offset += slice.length;
  }

  return bytes;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}
