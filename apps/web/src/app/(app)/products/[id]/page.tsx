import { DraftScreen } from '@/features/products/draft-screen';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ list?: string }>;
}) {
  const { id } = await params;
  const { list } = await searchParams;
  return <DraftScreen id={id} listId={list && UUID.test(list) ? list : null} />;
}
