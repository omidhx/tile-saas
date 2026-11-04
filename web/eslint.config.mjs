import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// فقط قواعدی که باگ واقعی می‌گیرند؛ قواعد سلیقه‌ای عمداً نیستند تا هر خطا معنا داشته باشد.
export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "src/db/generated/**", "public/**", "next-env.d.ts"] },
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
    // UI فعلی در فاز ۶ تا ۸ بازنویسی می‌شود؛ ۳۷ load() بدون await در effectها آن‌جا تکلیفشان روشن می‌شود.
    // بک‌اند، routeها و تست‌ها همین حالا پوشش داده می‌شوند. فاز ۶ این بلوک را حذف می‌کند.
    files: ["src/app/**/*.tsx", "src/lib/use*.ts"],
    rules: { "@typescript-eslint/no-floating-promises": "off", "@typescript-eslint/no-misused-promises": "off" },
  },
);
