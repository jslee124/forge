import React from "react";
import ReactDOM from "react-dom/client";
import type { AgentHealth } from "../../shared/desktop-api.js";
import "./styles.css";

function App(): React.JSX.Element {
  const [status, setStatus] = React.useState("Starting Agent…");

  React.useEffect(() => {
    void window.forgeDesktop
      .pingAgent()
      .then((health: AgentHealth) =>
        setStatus(
          health.resourcesAvailable
            ? `Agent ready · PID ${health.pid}`
            : "Agent resources unavailable",
        ),
      )
      .catch((error: unknown) =>
        setStatus(error instanceof Error ? error.message : "Agent unavailable"),
      );
  }, []);

  return (
    <main>
      <div className="mark">F</div>
      <h1>Forge Desktop</h1>
      <p>D02 Electron scaffold</p>
      <output>{status}</output>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Forge Desktop renderer root is missing");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
