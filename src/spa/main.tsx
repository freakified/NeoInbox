import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BulkActionProvider } from "./components/BulkActionConfirm";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <ErrorBoundary scope="app">
      <BulkActionProvider>
        <App />
      </BulkActionProvider>
    </ErrorBoundary>,
  );
}
