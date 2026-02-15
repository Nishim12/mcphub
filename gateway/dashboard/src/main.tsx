import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import App from "./App.tsx";
import "./index.css";

const qc = new QueryClient({
  defaultOptions: { queries: { refetchInterval: 5000, retry: 1 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <App />
      <Toaster theme="dark" position="bottom-right" richColors />
    </QueryClientProvider>
  </StrictMode>
);
