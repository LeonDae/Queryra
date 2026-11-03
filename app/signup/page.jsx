import { Suspense } from "react";
import AuthForm from "../auth-form.jsx";

export const metadata = { title: "Create an account | Queryra", description: "Create a Queryra account to access your workspace." };
export default function SignupPage() { return <Suspense><AuthForm mode="signup" /></Suspense>; }
