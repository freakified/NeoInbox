import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BulkActionProvider } from "./components/BulkActionConfirm";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <BulkActionProvider>
      <App />
    </BulkActionProvider>,
  );
}
