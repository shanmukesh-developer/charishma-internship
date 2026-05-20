import RestaurantMenuClient from './ClientPage';

export function generateStaticParams() {
  return [{ id: '1' }];
}

export const dynamicParams = true;

export default async function RestaurantMenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RestaurantMenuClient restaurantId={id} />;
}
