import "./globals.css"; 

export const metadata = {
  title: "Tutor Wallet",
  description: "Tutor Wallet",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}