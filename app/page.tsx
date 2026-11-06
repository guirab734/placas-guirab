import { redirect } from "next/navigation";
import { adminUser } from "./lib/admin-auth";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await adminUser();
  if (!user) redirect("/login");
  return <Dashboard userName={user.displayName} userEmail={user.email} />;
}
