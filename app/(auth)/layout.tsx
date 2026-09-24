export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <div className="mx-auto w-full max-w-md px-4 py-8">{children}</div>;
}
