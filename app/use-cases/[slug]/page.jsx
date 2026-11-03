import { notFound } from "next/navigation";
import UseCasePage from "../../use-case-page.jsx";
import { useCases } from "../../use-case-data.js";

export function generateStaticParams() {
  return useCases.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const useCase = useCases.find((item) => item.slug === slug);
  return useCase
    ? { title: `${useCase.cardTitle} — Queryra`, description: useCase.summary }
    : { title: "Use case — Queryra" };
}

export default async function Page({ params }) {
  const { slug } = await params;
  const useCase = useCases.find((item) => item.slug === slug);
  if (!useCase) notFound();
  return <UseCasePage useCase={useCase} />;
}
