import nextConfig from "eslint-config-next/core-web-vitals";
import tsConfig from "eslint-config-next/typescript";

export default [
  ...nextConfig,
  ...tsConfig,
  {
    rules: {
      // setState synchronously in useEffect is intentional in this codebase
      // (sessionStorage restore, fetch state resets on timeRange change)
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
