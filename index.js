// v2 plugin-loader entry: directory plugins are loaded via <dir>/index.js,
// not package.json main. Re-export the PR #3 v2 mount ({ id, setup }).
export { default, setupV2 } from "./dist/server.js";
