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
    "next-env.d.ts",
  ]),
  {
    // Data-fetching pattern: useEffect(() => { void fetchFn() }, [fetchFn])
    // is a well-established React pattern. The react-hooks/set-state-in-effect
    // rule from the React Compiler config flags this as a false positive when
    // the setState call is inside an async function called from the effect.
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
    linterOptions: {
      // Existing source files have eslint-disable comments for the rule we
      // just turned off globally. Don't warn about them being unused.
      reportUnusedDisableDirectives: false,
    },
  },
]);

export default eslintConfig;
