import ProductDetailClient from './ClientPage';

export function generateStaticParams() {
  return [{ id: '1' }];
}

export const dynamicParams = true;

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductDetailClient productId={id} />;
}
