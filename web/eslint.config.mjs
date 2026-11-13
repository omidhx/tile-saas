import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// فقط قواعدی که باگ واقعی می‌گیرند؛ قواعد سلیقه‌ای عمداً نیستند تا هر خطا معنا داشته باشد.
export default tseslint.config(
  { ignores: [".next/**", "dist-scripts/**", "node_modules/**", "src/db/generated/**", "public/**", "next-env.d.ts"] },
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true },
    },
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": reactHooks },
    rules: {
      "@typescript-eslint/no-floating-promises": ["error", {
        // test() از node:test پرامیس برمی‌گرداند و runner خودش منتظرش می‌ماند
        allowForKnownSafeCalls: [{ from: "package", name: ["test", "before", "after", "beforeEach", "afterEach"], package: "node:test" }],
      }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/await-thenable": "error",
      "react-hooks/rules-of-hooks": "error",
      "no-dupe-keys": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-unreachable": "error",
      "no-cond-assign": "error",
      "no-fallthrough": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
  {
    // UI قدیمی (`(legacy)`) در فاز ۷ و ۸ بازنویسی می‌شود؛ ۳۷ load() بدون await در effectها آن‌جا تکلیفشان روشن می‌شود.
    // UI تازه (`(app)`)، بک‌اند، routeها و تست‌ها پوشش داده می‌شوند. با خالی شدن `(legacy)` این بلوک حذف می‌شود.
    files: ["src/app/(legacy)/**/*.tsx", "src/lib/use*.ts"],
    rules: { "@typescript-eslint/no-floating-promises": "off", "@typescript-eslint/no-misused-promises": "off" },
  },
);
