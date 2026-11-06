import type { Metadata } from "next";
import "./globals.css";
import "./next-workspace.css";
import "./fieldwork-next.css";

export const metadata: Metadata = {
  title: "Guirab · Placas",
  description: "Suas lojas, plaquinhas NFC e avaliações no Google em um só lugar.",
  robots: { index: false, follow: false },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('guirab-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch{}" }} /></head>
      <body className="antialiased guirab-next">{children}</body>
    </html>
  );
}
