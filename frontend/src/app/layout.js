import "./globals.css";
import { Playfair_Display, Inter } from "next/font/google";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-playfair",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata = {
  title: "SMG Joyería - Catálogo Mayorista",
  description: "Catálogo mayorista SMG Joyería",
};

// viewport-fit=cover habilita env(safe-area-inset-*) en iPhones con notch y
// barra inferior (se usa en el drawer del carrito y en las acciones admin).
// interactive-widget=resizes-content hace que el viewport se achique cuando
// se abre el teclado en el celular: el footer del checkout (con el total) no
// queda tapado por el teclado.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${playfair.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
