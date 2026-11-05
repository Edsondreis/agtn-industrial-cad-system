import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

requestAnimationFrame(() => {
  const s = document.getElementById("splash");
  if (s) {
    s.style.opacity = "0";
    setTimeout(() => s.remove(), 300);
  }
});
