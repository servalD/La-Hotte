import { ListScreen } from '@/features/lists/list-screen';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListScreen id={id} />;
}
