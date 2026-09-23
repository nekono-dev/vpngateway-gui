import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root";
import { AuthProvider } from "./contexts/AuthContext";
import { ToastProvider } from "./notifications/ToastProvider";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);

// PWAとしてホーム画面追加・オフライン起動を可能にする（Service Workerが使える環境のみ）。
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 登録に失敗してもアプリ自体の動作には影響しないため、握りつぶす。
    });
  });
}
