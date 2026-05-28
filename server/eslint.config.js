import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const noComments = {
  rules: {
    "no-comments": {
      meta: {
        type: "problem",
        docs: { description: "Disallow comments anywhere in the codebase." },
        schema: [],
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        return {
          Program() {
            for (const comment of sourceCode.getAllComments()) {
              context.report({
                loc: comment.loc,
                message: "Comments are not allowed in this project.",
              });
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { local: noComments },
    rules: {
      "local/no-comments": "error",
    },
  },
  prettier,
);
