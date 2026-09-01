// Entry point for the Roam developer-extension build. The real lifecycle
// (onload/onunload) lives in loader.tsx; this indirection exists because the
// bundle entry must be a plain .ts file.
export { default } from "./loader";
