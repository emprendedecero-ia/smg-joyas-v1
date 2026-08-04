import CatalogApp from "@/components/CatalogApp";
import { CartProvider } from "@/lib/cart";
import { fetchJson } from "@/lib/api";

export const dynamic = "force-dynamic";

async function getCatalogData() {
  const [products, categories] = await Promise.all([
    fetchJson("/api/products"),
    fetchJson("/api/categories"),
  ]);
  return { products, categories };
}

export default async function HomePage() {
  let products = [];
  let categories = [];

  try {
    ({ products, categories } = await getCatalogData());
  } catch {
    products = [];
    categories = [];
  }

  return (
    <CartProvider>
      <CatalogApp initialProducts={products} categories={categories} />
    </CartProvider>
  );
}
