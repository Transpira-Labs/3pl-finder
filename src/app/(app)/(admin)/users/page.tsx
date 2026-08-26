import { redirect } from "next/navigation";

/** Team management moved into Settings → Team. Keep this path working. */
export default function UsersPage() {
  redirect("/settings");
}
