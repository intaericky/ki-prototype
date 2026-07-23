import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    ".vinext/**",
    ".wrangler/**",
    // Embedded original prototypes are shipped as static assets.
    "public/projects/**",
    // Local duplicate drafts are not part of the application.
    "app/layout 2.tsx",
    "app/page 2.tsx",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Existing client effects synchronize embedded prototypes and persisted UI.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
