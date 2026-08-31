// Compatibility facade for the interactive CLI. Domain ownership lives under
// ./interactive so existing CLI and test imports remain stable during v0.3.4.
export * from "./interactive/app.js";
export * from "./interactive/approvals.js";
