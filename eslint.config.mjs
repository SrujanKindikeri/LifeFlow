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
    rules: {
      // Data-fetching pattern: useEffect(() => { void fetchFn() }, [fetchFn])
      // is a well-established React pattern. The react-hooks/set-state-in-effect
      // rule from the React Compiler config flags this as a false positive when
      // the setState call is inside an async function called from the effect.
      "react-hooks/set-state-in-effect": "off",

      // Allow parameters prefixed with _ to be unused.
      // TypeScript interfaces may require named parameters even when unused
      // (e.g. StorageAdapter.getSignedUrl(_fileId), OcrProvider.extract(_mimeType)).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          "argsIgnorePattern": "^_",
          "varsIgnorePattern": "^_",
          "caughtErrorsIgnorePattern": "^_"
        }
      ],
    },
    linterOptions: {
      // Existing source files have eslint-disable comments for rules we
      // turned off globally. Don't warn about them being unused.
      reportUnusedDisableDirectives: false,
    },
  },
]);

export default eslintConfig;
