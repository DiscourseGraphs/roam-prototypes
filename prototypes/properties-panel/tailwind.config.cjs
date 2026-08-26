const base = require("../../packages/extension-base/tailwind.config.cjs");

module.exports = {
  ...base,
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
};
