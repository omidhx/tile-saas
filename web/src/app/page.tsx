import { redirect } from "next/navigation";

export default function Home() {
  redirect("/reserve"); // /reserve خودش اگر لاگین نبود به /login می‌فرسته
}
