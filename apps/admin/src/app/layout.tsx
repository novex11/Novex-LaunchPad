import "@novex/ui/globals.css";
import "./globals.css";

export const metadata = {
  title: "Novex Admin",
  description: "Internal ops console",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <header className="border-b border-border px-6 py-4">
          <h1 className="font-serif text-xl">Novex Admin</h1>
        </header>
        {children}
      </body>
    </html>
  );
}
