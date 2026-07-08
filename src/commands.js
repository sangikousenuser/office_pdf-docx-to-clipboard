import { exportPdfAndDocx } from "./office-export.js";

Office.onReady(() => {
  Office.actions.associate("exportAndCopy", async (event) => {
    try {
      await exportPdfAndDocx();
    } catch (error) {
      console.error(error);
    } finally {
      event.completed();
    }
  });
});
