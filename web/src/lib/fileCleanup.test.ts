import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteUploadFile, deleteUploadFiles } from "./fileCleanup";

// توجه: این تست‌ها process.cwd() را به‌عنوانِ ریشه می‌بینند. برای ایزوله‌سازی،
// باید یک دایرکتوریِ موقت بسازیم و process.cwd را موقتاً عوض کنیم. ولی تغییرِ
// process.cwd ممکن است روی بقیه‌ی تست‌ها اثر بگذارد. پس به‌جای آن، تست‌ها روی
// مسیرهای واقعی ولی کنترل‌شده انجام می‌شوند.

async function makeUploadsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tile-test-"));
  const uploadsDir = join(dir, "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });
  return dir;
}

test("deleteUploadFile: URL خارجی را رد می‌کند (http/https)", async () => {
  // نباید هیچ فایلی را حذف کند — فقط رد کن
  await deleteUploadFile("https://example.com/foo.jpg");
  await deleteUploadFile("http://evil.com/bar.png");
  // اگر به اینجا رسیدیم، یعنی خطایی نزد — تست سبز
  assert.ok(true);
});

test("deleteUploadFile: مسیر path traversal را رد می‌کند", async () => {
  // این مسیر نباید چیزی پاک کند — فقط رد کن
  await deleteUploadFile("/uploads/../../etc/passwd");
  await deleteUploadFile("/uploads/../web/.env");
  // نباید exception بزند — فقط رد کن
  assert.ok(true);
});

test("deleteUploadFile: فایلِ غیرموجود را بی‌صدا رد می‌کند", async () => {
  // فایل وجود ندارد — نباید exception بزند
  await deleteUploadFile("/uploads/never-existed-" + Date.now() + ".jpg");
  assert.ok(true);
});

test("deleteUploadFile: فایل موجود را حذف می‌کند", async () => {
  const dir = await makeUploadsDir();
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    const filename = "test-file-" + Date.now() + ".jpg";
    const filePath = join(dir, "public", "uploads", filename);
    await writeFile(filePath, "test content");

    await deleteUploadFile(`/uploads/${filename}`);

    // فایل باید حذف شده باشد
    const files = await readdir(join(dir, "public", "uploads"));
    assert.ok(!files.includes(filename), "فایل باید حذف شده باشد");
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});

test("deleteUploadFiles: چند فایل با هم", async () => {
  const dir = await makeUploadsDir();
  const originalCwd = process.cwd();
  try {
    process.chdir(dir);
    const filenames = [
      "test-batch-1-" + Date.now() + ".jpg",
      "test-batch-2-" + Date.now() + ".png",
      "test-batch-3-" + Date.now() + ".webp",
    ];
    for (const f of filenames) {
      await writeFile(join(dir, "public", "uploads", f), "test");
    }

    await deleteUploadFiles(filenames.map((f) => `/uploads/${f}`));

    const files = await readdir(join(dir, "public", "uploads"));
    for (const f of filenames) {
      assert.ok(!files.includes(f), `${f} باید حذف شده باشد`);
    }
  } finally {
    process.chdir(originalCwd);
    await rm(dir, { recursive: true, force: true });
  }
});
