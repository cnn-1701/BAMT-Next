import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

function showFatal(error: unknown) {
  const root = document.getElementById("root") ?? document.body;
  const message = error instanceof Error ? `${error.message}

${error.stack ?? ""}` : String(error);
  root.innerHTML = `
    <main style="min-height:100vh;padding:28px;background:#edf5fb;color:#16314a;font-family:Consolas,'Microsoft YaHei',monospace;box-sizing:border-box;">
      <h1 style="margin:0 0 16px;font:800 24px 'Microsoft YaHei',sans-serif;">BAMT Next ??????</h1>
      <p style="font:600 15px 'Microsoft YaHei',sans-serif;">???????????????????? Codex????????</p>
      <pre style="white-space:pre-wrap;margin-top:18px;padding:16px;border:1px solid #bdd6ea;border-radius:8px;background:white;color:#b3261e;line-height:1.55;">${message.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char] || char))}</pre>
    </main>`;
}

window.addEventListener("error", (event) => showFatal(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => showFatal(event.reason));

try {
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element in index.html");
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (error) {
  showFatal(error);
}
