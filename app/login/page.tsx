import { redirect } from "next/navigation";
import { adminUser } from "../lib/admin-auth";
import LoginForm from "./login-form";
import "./login.css";

export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (await adminUser()) redirect("/");
  return <LoginForm />;
}
