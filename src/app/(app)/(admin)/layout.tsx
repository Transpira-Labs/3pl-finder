/** Admin-only subtree. Auth bypassed for demo. */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
