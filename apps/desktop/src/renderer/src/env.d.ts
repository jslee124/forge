import type { DesktopApi } from "../../shared/desktop-api.js";

declare global {
  interface Window {
    readonly forgeDesktop: DesktopApi;
  }
}
