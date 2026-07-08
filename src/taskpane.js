import { exportPdfAndDocx } from "./office-export.js";

Office.onReady(() => {
  const button = document.getElementById("exportButton");
  const status = document.getElementById("status");

  button.addEventListener("click", async () => {
    button.disabled = true;

    try {
      await exportPdfAndDocx((message) => {
        status.textContent = message;
      });
    } catch (error) {
      status.textContent = error.message;
      console.error(error);
    } finally {
      button.disabled = false;
    }
  });
});
