import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'M|R Walls Shop Drawing QC',
  description: 'Pre-flight quality check for shop drawings before Carlo review',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
